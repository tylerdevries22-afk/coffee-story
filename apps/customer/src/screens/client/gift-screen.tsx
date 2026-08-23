import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { CollapsingScreen } from '@/components/collapsing-screen';
import { Body, Button, Card, Eyebrow, PillRow, Screen, SectionTitle, Title } from '@/components/ui';
import { mobileApi } from '@/lib/mobile-api';
import { useAppState } from '@/state/app-context';
import { useAuth } from '@/state/auth-context';
import { useDemo } from '@/state/demo-context';
import { GiftCardSheet, GiftGallery, GiftInfoSheet } from '@/components/gift/gift-shelves';
import { giftDesignByKey, type GiftDesign } from '@/data/gift-designs';
import { tierForAnnualPoints } from '@/features/rewards/rules';
import { BUSINESS, BUSINESS_MONOGRAM } from '@/data/business';
import { colors, fonts, radius, spacing } from '@/theme/tokens';
import type { GiftCard } from '@/types/domain';
import { choiceState } from '@/lib/a11y-state';

const AMOUNTS = [50, 75, 100, 150, 200] as const;

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
  const { startBooking } = useAppState();
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
          status: deliveryAt ? 'pending' : 'delivered',
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
          pointsPerDollar={tierForAnnualPoints(portal.rewardAccount.annualPoints).pointsPerDollar}
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
  if (view === 'recipient') return <RecipientExperience initialToken={claimToken} isDemo={isDemo} onBook={() => startBooking()} onBack={() => setView('gallery')} />;
  if (view === 'detail' && selectedGift) return <GiftDetail gift={selectedGift} onBook={() => startBooking()} onBack={() => setView('gallery')} />;
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

function GiftWallet({
  gifts,
  onOpen,
  onBuy,
  onBack,
}: {
  gifts: GiftCard[];
  onOpen: (gift: GiftCard) => void;
  onBuy: () => void;
  onBack: () => void;
}) {
  const received = gifts.filter((gift) => gift.claimedByCurrentUser);
  const sent = gifts.filter((gift) => gift.purchasedByCurrentUser);
  return (
    <CollapsingScreen title="My gift cards" eyebrow="Stored value" onBack={onBack} backLabel="Gift cards">
      <Body muted>Open a card to see its balance and continue into booking.</Body>
      <SectionTitle>Received</SectionTitle>
      {received.map((gift) => (
        <PillRow
          key={gift.id}
          title={gift.code}
          subtitle={`$${(gift.balanceCents / 100).toFixed(2)} · ${gift.status}`}
          symbol="creditcard"
          onPress={() => onOpen(gift)}
        />
      ))}
      {!received.length ? <Card><Body muted>No received gift cards yet.</Body></Card> : null}
      <SectionTitle>Sent</SectionTitle>
      {sent.map((gift) => (
        <PillRow
          key={gift.id}
          title={gift.recipientName || gift.recipientEmail || 'Recipient'}
          subtitle={`$${(gift.initialCents / 100).toFixed(2)} · ${gift.status}`}
          symbol="gift"
          onPress={() => onOpen(gift)}
        />
      ))}
      {!sent.length ? <Card><Body muted>No sent gifts yet.</Body></Card> : null}
      <Button label="Buy another gift card" onPress={onBuy} />
    </CollapsingScreen>
  );
}

type PurchaseProps = {
  amount: number;
  recipientName: string;
  recipient: string;
  message: string;
  delivery: 'now' | 'week';
  loading: boolean;
  setAmount: (amount: number) => void;
  setRecipientName: (name: string) => void;
  setRecipient: (email: string) => void;
  setMessage: (message: string) => void;
  setDelivery: (delivery: 'now' | 'week') => void;
  onBack: () => void;
  onPay: () => void;
};

function Purchase({ amount, recipientName, recipient, message, delivery, loading, setAmount, setRecipientName, setRecipient, setMessage, setDelivery, onBack, onPay }: PurchaseProps) {
  return (
    <CollapsingScreen title="Send a digital gift" eyebrow="Gift cards" onBack={onBack} backLabel="Gift cards" keyboardShouldPersistTaps="handled">
      <View style={styles.preview}><LinearGradient colors={[colors.brand300, colors.brand700]} style={StyleSheet.absoluteFill} /><Text style={styles.previewMark}>{BUSINESS.name}</Text><Text style={styles.previewAmount}>${amount}</Text></View>
      <SectionTitle>Choose an amount</SectionTitle>
      <View accessibilityRole="radiogroup" style={styles.amounts}>{AMOUNTS.map((value) => (
        <Pressable
          key={value}
          accessibilityRole="radio"
          {...choiceState(amount === value)}
          onPress={() => setAmount(value)}
          style={({ pressed }) => [styles.amount, amount === value && styles.amountActive, pressed && styles.pressed]}
        >
          <Text style={[styles.amountText, amount === value && styles.amountTextActive]}>${value}</Text>
        </Pressable>
      ))}</View>
      <Field label="Recipient name" value={recipientName} onChangeText={setRecipientName} placeholder="Jordan" />
      <Field label="Recipient email" value={recipient} onChangeText={setRecipient} keyboardType="email-address" placeholder="friend@example.com" />
      <Field label="A note from you" value={message} onChangeText={setMessage} placeholder="A little time, just for you." multiline />
      <SectionTitle>Delivery</SectionTitle>
      <View accessibilityRole="radiogroup" style={styles.amounts}>
        <Pressable accessibilityRole="radio" {...choiceState(delivery === 'now')} onPress={() => setDelivery('now')} style={({ pressed }) => [styles.deliveryChoice, delivery === 'now' && styles.amountActive, pressed && styles.pressed]}><Text style={[styles.amountText, delivery === 'now' && styles.amountTextActive]}>Send after payment</Text></Pressable>
        <Pressable accessibilityRole="radio" {...choiceState(delivery === 'week')} onPress={() => setDelivery('week')} style={({ pressed }) => [styles.deliveryChoice, delivery === 'week' && styles.amountActive, pressed && styles.pressed]}><Text style={[styles.amountText, delivery === 'week' && styles.amountTextActive]}>Deliver in 1 week</Text></Pressable>
      </View>
      <Card style={styles.legal}><Body muted>Digital gift card sales are final. Funds never expire. A secure claim link is emailed after payment.</Body></Card>
      <Button label={`Pay $${amount} securely`} loading={loading} onPress={onPay} />
    </CollapsingScreen>
  );
}

function Field({ label, ...props }: React.ComponentProps<typeof TextInput> & { label: string }) {
  return <View style={styles.field}><Text style={styles.fieldLabel}>{label}</Text><TextInput accessibilityLabel={`${label} input`} {...props} placeholderTextColor={colors.ink400} style={[styles.input, props.multiline && styles.multiline]} /></View>;
}

function RecipientExperience({ initialToken, isDemo, onBook, onBack }: { initialToken: string; isDemo: boolean; onBook: () => void; onBack: () => void }) {
  const { portal, refresh } = useAuth();
  const demo = useDemo();
  const [token, setToken] = useState(initialToken);
  const [claimed, setClaimed] = useState<{ code: string; balanceCents: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [claimRequestKey] = useState(
    () => `claim-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`,
  );
  const isAdded = claimed
    ? portal.giftCards.some((gift) => gift.code === claimed.code)
    : false;

  function addClaimedGift() {
    if (!claimed || isAdded) return;
    if (!isDemo) return;
    demo.addGift({
      code: claimed.code,
      initialCents: claimed.balanceCents,
      balanceCents: claimed.balanceCents,
      recipientEmail: portal.profile.email,
      recipientName: portal.profile.fullName,
      designKey: 'guest-gift',
      deliveryAt: null,
      status: 'claimed',
      claimedByCurrentUser: true,
      purchasedByCurrentUser: false,
    });
    Alert.alert('Gift added', 'This gift is now available in My gift cards.');
  }

  async function claim() {
    if (token.trim().length < 32) {
      setError('Paste the full secure token from your gift link.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      if (isDemo) {
        setClaimed({ code: `${BUSINESS.giftCodePrefix}-GUEST-DEMO`, balanceCents: 6000 });
        return;
      }
      const result = await mobileApi.claimGift(token.trim(), claimRequestKey);
      await refresh();
      setClaimed({ code: result.code, balanceCents: result.balanceCents });
    } catch (claimError) {
      setError(claimError instanceof Error ? claimError.message : 'This gift could not be claimed.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <CollapsingScreen
      title={claimed ? 'Your gift is ready' : 'A gift for you'}
      eyebrow="Guest gift access"
      onBack={onBack}
      backLabel="Gift cards"
    >
      <View style={styles.preview}><LinearGradient colors={[colors.gold300, colors.brand600]} style={StyleSheet.absoluteFill} /><Text style={styles.previewMark}>{BUSINESS.name}</Text><Text style={styles.previewAmount}>{claimed ? `$${(claimed.balanceCents / 100).toFixed(0)}` : 'A gift'}</Text></View>
      {claimed ? (
        <>
          <PillRow title={claimed.code} subtitle={`$${(claimed.balanceCents / 100).toFixed(2)} available · never expires`} symbol="creditcard" />
          <Button label="Order as a guest" onPress={onBook} />
          {isDemo ? (
            <Button
              label={isAdded ? 'Added to my account' : 'Add to my account'}
              variant="secondary"
              disabled={isAdded}
              onPress={addClaimedGift}
            />
          ) : isAdded ? (
            <Button label="Added to my account" variant="secondary" disabled onPress={() => undefined} />
          ) : (
            <Body muted>Gift accepted. It will appear in your account after the secure claim finishes syncing.</Body>
          )}
        </>
      ) : (
        <>
          <Field label="Secure gift token" value={token} onChangeText={setToken} autoCapitalize="none" placeholder="Paste the token from your email" />
          {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
          <Button label="Accept this gift" loading={loading} onPress={() => void claim()} />
        </>
      )}
    </CollapsingScreen>
  );
}

function GiftDetail({ gift, onBook, onBack }: { gift: GiftCard; onBook: () => void; onBack: () => void }) {
  return (
    <CollapsingScreen title={gift.recipientName || 'A gift of care'} eyebrow="My gift card" onBack={onBack} backLabel="Gift cards">
      <View style={styles.preview}>
        <LinearGradient colors={[colors.brand300, colors.brand700]} style={StyleSheet.absoluteFill} />
        <Text style={styles.previewMark}>{gift.code}</Text>
        <Text style={styles.previewAmount}>${(gift.balanceCents / 100).toFixed(0)}</Text>
      </View>
      <PillRow title="Available balance" subtitle={`$${(gift.balanceCents / 100).toFixed(2)} · ${gift.status}`} symbol="creditcard" />
      {gift.recipientEmail ? <PillRow title="Recipient" subtitle={gift.recipientEmail} symbol="message" /> : null}
      <Button label="Order with this gift" onPress={onBook} />
    </CollapsingScreen>
  );
}

function SentScreen({ amount, recipient, isDemo, onReset }: { amount: number; recipient: string; isDemo: boolean; onReset: () => void }) {
  return (
    <Screen contentContainerStyle={styles.sent}>
      <View style={styles.sentMark}><Text style={styles.sentMarkText}>{BUSINESS_MONOGRAM}</Text></View>
      <Eyebrow>Gift sent</Eyebrow>
      <Title>${amount} of care is on its way.</Title>
      <Body muted>{isDemo ? `Preview complete for ${recipient}; no email or payment was sent.` : `A secure gift link will be delivered to ${recipient}.`}</Body>
      <Button label="Send another gift" onPress={onReset} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  myCards: { height: 180, borderRadius: radius.lg, overflow: 'hidden', justifyContent: 'center' },
  myCardsCopy: { width: '68%', padding: spacing.lg, gap: spacing.sm },
  myCardsTitle: { color: colors.ink900, fontFamily: fonts.display, fontSize: 26 },
  giftGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  cardList: { gap: spacing.xs },
  design: { width: '47%', aspectRatio: 1.32, borderRadius: radius.md, overflow: 'hidden', justifyContent: 'space-between', padding: spacing.md },
  designMark: { color: colors.white, fontFamily: fonts.display, fontSize: 24 },
  designTitle: { color: colors.white, fontFamily: fonts.sansBold, fontSize: 15 },
  preview: { height: 220, borderRadius: radius.lg, overflow: 'hidden', padding: spacing.lg, justifyContent: 'space-between' },
  previewMark: { color: colors.white, fontFamily: fonts.display, fontSize: 26 },
  previewAmount: { color: colors.white, fontFamily: fonts.display, fontSize: 58, alignSelf: 'flex-end' },
  amounts: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  amount: { minWidth: 70, height: 48, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.ink200, alignItems: 'center', justifyContent: 'center' },
  deliveryChoice: { minHeight: 48, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.ink200, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.md },
  amountActive: { backgroundColor: colors.brand600, borderColor: colors.brand600 },
  amountText: { color: colors.ink700, fontFamily: fonts.sansBold, fontSize: 14 },
  amountTextActive: { color: colors.white },
  field: { gap: spacing.sm },
  fieldLabel: { color: colors.ink900, fontFamily: fonts.sansBold, fontSize: 14 },
  input: { minHeight: 54, borderRadius: radius.md, borderWidth: 1, borderColor: colors.ink300, paddingHorizontal: spacing.md, color: colors.ink900, fontFamily: fonts.sans, fontSize: 15, backgroundColor: colors.white },
  multiline: { minHeight: 104, paddingTop: spacing.md, textAlignVertical: 'top' },
  legal: { padding: spacing.md, backgroundColor: colors.brand50 },
  error: { color: colors.danger, fontFamily: fonts.sansMedium, fontSize: 13 },
  sent: { minHeight: '100%', justifyContent: 'center', paddingBottom: 140 },
  sentMark: { width: 104, height: 104, borderRadius: 52, alignSelf: 'center', alignItems: 'center', justifyContent: 'center', backgroundColor: colors.brand200 },
  sentMarkText: { color: colors.brand700, fontFamily: fonts.display, fontSize: 32 },
  pressed: { opacity: 0.72, transform: [{ scale: 0.99 }] },
});
