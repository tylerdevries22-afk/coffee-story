import { useEffect, useState } from 'react';
import { Alert } from 'react-native';

import { GiftCardSheet, GiftGallery, GiftInfoSheet } from '@/components/gift/gift-shelves';
import { BUSINESS } from '@/data/business';
import { giftDesignByKey, type GiftDesign } from '@/data/gift-designs';
import { useAppState } from '@/state/app-context';
import { useAuth } from '@/state/auth-context';
import { useDemo } from '@/state/demo-context';
import { TENANT_REWARD_TIERS } from '@/tenant';
import { tierForAnnualPoints, type GiftCard } from '@platform/domain';

import { GiftDetail, RecipientExperience, SentScreen } from './gift-recipient';
import { Purchase } from './gift-purchase';
import { GiftWallet } from './gift-wallet';

type GiftView = 'gallery' | 'wallet' | 'purchase' | 'recipient' | 'detail' | 'sent' | 'card' | 'info';
export function GiftScreen({
  initialClaimToken,
  onClaimTokenConsumed,
}: {
  initialClaimToken: string | null;
  onClaimTokenConsumed: () => void;
}) {
  const [view, setView] = useState<GiftView>('gallery');
  const [amount, setAmount] = useState(100);
  const [recipientName, setRecipientName] = useState('');
  const [recipient, setRecipient] = useState('');
  const [message, setMessage] = useState('');
  const [designKey, setDesignKey] = useState('quiet-hour');
  const [quantity, setQuantity] = useState(1);
  const [delivery, setDelivery] = useState<'now' | 'week'>('now');
  const [loading, setLoading] = useState(false);
  const [claimToken, setClaimToken] = useState('');
  const [selectedGift, setSelectedGift] = useState<GiftCard | null>(null);
  const [paymentMethodId, setPaymentMethodId] = useState<string | null>(null);
  const { isDemo, portal } = useAuth();
  const demo = useDemo();
  const { startOrder } = useAppState();
  const paymentMethods = portal.paymentMethods ?? [];
  const selectedPaymentMethod = paymentMethods.find((method) => method.id === paymentMethodId)
    ?? paymentMethods.find((method) => method.isDefault)
    ?? paymentMethods[0]
    ?? null;

  function cyclePaymentMethod() {
    if (!paymentMethods.length) {
      Alert.alert('No card on file', 'Add a payment method in Account settings before purchasing a gift card.');
      return;
    }
    const currentIndex = paymentMethods.findIndex((method) => method.id === selectedPaymentMethod?.id);
    const next = paymentMethods[(currentIndex + 1) % paymentMethods.length] ?? paymentMethods[0];
    setPaymentMethodId(next.id);
  }

  useEffect(() => {
    if (!initialClaimToken) return;
    let active = true;
    void Promise.resolve().then(() => {
      if (!active) return;
      setClaimToken(initialClaimToken);
      setView('recipient');
      onClaimTokenConsumed();
    });
    return () => {
      active = false;
    };
  }, [initialClaimToken, onClaimTokenConsumed]);

  async function pay() {
    if (!recipient.includes('@')) {
      Alert.alert('Recipient needed', 'Add a valid recipient email before continuing.');
      return;
    }
    setLoading(true);
    try {
      if (isDemo) {
        const deliveryAt = delivery === 'week' ? new Date(Date.now() + 7 * 86_400_000).toISOString() : null;
        demo.addGift({
          code: `${BUSINESS.giftCodePrefix}-DEMO-${String(Date.now()).slice(-6)}`,
          initialCents: amount * 100,
          balanceCents: amount * 100,
          recipientEmail: recipient.trim(),
          recipientName: recipientName.trim() || null,
          designKey,
          deliveryAt,
          status: deliveryAt ? 'created' : 'delivered',
          claimedByCurrentUser: false,
          purchasedByCurrentUser: true,
        });
        setView('sent');
        return;
      }
      // Gift purchases go live with card payments (Square). Until then the
      // full flow works in Demo and live accounts see the honest state.
      Alert.alert('Coming soon', 'Gift card purchases are coming to live accounts soon. Preview the whole flow in Demo.');
      return;
    } catch (paymentError) {
      Alert.alert(
        'Payment could not be completed',
        paymentError instanceof Error ? paymentError.message : 'Your card was not charged. Please try again.',
      );
    } finally {
      setLoading(false);
    }
  }

  /**
   * "Buy now, send later": cards land in the buyer's own wallet with no
   * recipient, and are addressed later from My Gift Cards. Distinct from pay(),
   * which sends a card straight to someone.
   */
  async function buyCards() {
    if (isDemo && !selectedPaymentMethod) {
      Alert.alert('No card on file', 'Add a payment method in Account settings before purchasing a gift card.');
      return;
    }
    setLoading(true);
    try {
      if (isDemo) {
        for (let index = 0; index < quantity; index += 1) {
          demo.addGift({
            code: `${BUSINESS.giftCodePrefix}-DEMO-${String(Date.now() + index).slice(-6)}`,
            initialCents: amount * 100,
            balanceCents: amount * 100,
            recipientEmail: portal.profile.email,
            recipientName: portal.profile.fullName,
            designKey,
            deliveryAt: null,
            status: 'delivered',
            claimedByCurrentUser: true,
            purchasedByCurrentUser: true,
          });
        }
        setView('wallet');
        return;
      }
      Alert.alert('Coming soon', 'Gift card purchases are coming to live accounts soon. Preview the whole flow in Demo.');
      return;
    } catch (purchaseError) {
      Alert.alert(
        'Payment could not be completed',
        purchaseError instanceof Error ? purchaseError.message : 'Your card was not charged. Please try again.',
      );
    } finally {
      setLoading(false);
    }
  }

  function openDesign(design: GiftDesign) {
    setDesignKey(design.key);
    setView('card');
  }

  if (view === 'info') return <GiftInfoSheet onClose={() => setView('gallery')} />;
  if (view === 'card') {
    const design = giftDesignByKey(designKey) ?? giftDesignByKey('quiet-hour');
    if (design) {
      return (
        <GiftCardSheet
          design={design}
          amount={amount}
          quantity={quantity}
          pointsPerDollar={tierForAnnualPoints(portal.rewardAccount.annualPoints, TENANT_REWARD_TIERS).pointsPerDollar}
          paymentMethod={selectedPaymentMethod}
          loading={loading}
          onAmountChange={setAmount}
          onQuantityChange={setQuantity}
          onPaymentMethodChange={cyclePaymentMethod}
          onClose={() => {
            setView('gallery');
          }}
          onPay={buyCards}
        />
      );
    }
  }
  if (view === 'purchase') return <Purchase amount={amount} recipientName={recipientName} recipient={recipient} message={message} delivery={delivery} loading={loading} setAmount={setAmount} setRecipientName={setRecipientName} setRecipient={setRecipient} setMessage={setMessage} setDelivery={setDelivery} onBack={() => setView('gallery')} onPay={pay} />;
  if (view === 'wallet') return <GiftWallet gifts={portal.giftCards} onOpen={(gift) => {
    setSelectedGift(gift);
    setView('detail');
  }} onBuy={() => setView('purchase')} onBack={() => setView('gallery')} />;
  if (view === 'recipient') return <RecipientExperience initialToken={claimToken} isDemo={isDemo} onBook={() => startOrder()} onBack={() => setView('gallery')} />;
  if (view === 'detail' && selectedGift) return <GiftDetail gift={selectedGift} onBook={() => startOrder()} onBack={() => setView('gallery')} />;
  if (view === 'sent') return <SentScreen amount={amount} recipient={recipient} isDemo={isDemo} onReset={() => setView('gallery')} />;

  return (
    <GiftGallery
      walletCount={portal.giftCards.length}
      onOpenWallet={() => setView('wallet')}
      onOpenInfo={() => setView('info')}
      onSelectDesign={openDesign}
    />
  );
}
