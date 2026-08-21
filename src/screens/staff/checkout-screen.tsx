import { useStripe } from '@/lib/stripe';
import { useMemo, useState } from 'react';
import { Alert } from 'react-native';

import { CollapsingScreen } from '@/components/collapsing-screen';
import { Body } from '@/components/ui';
import {
  addCartLine,
  changeCartQty,
  registerTotals,
  removeCartLine,
  selectVisitLines,
  visitLines,
  TIP_RATES,
  type CartLine,
  type TipOption,
} from '@/features/staff/pos-totals';
import { isStaffTenderAvailable } from '@/features/staff/payment-availability';
import { mobileApi } from '@/lib/mobile-api';
import { useAuth } from '@/state/auth-context';
import type { PortalAppointment } from '@/types/domain';

import { CartSection } from './checkout/cart-section';
import { PaymentSection, METHODS, type MethodKey } from './checkout/payment-section';
import { ReceiptSection, type Receipt } from './checkout/receipt-section';
import { StepIndicator, stepSubtitle, type Step } from './checkout/step-indicator';

export function CheckoutScreen({ appointments, onComplete, promptForTip, onBack }: {
  appointments: PortalAppointment[];
  onComplete: (appointmentId: string) => Promise<void>;
  promptForTip: boolean;
  /** Pushed-page affordance; omit when checkout ever lives somewhere with its own chrome. */
  onBack?: () => void;
}) {
  const { isDemo } = useAuth();
  const stripe = useStripe();
  const eligible = useMemo(
    () => appointments.filter((appointment) => appointment.status === 'confirmed' || appointment.status === 'pending'),
    [appointments],
  );

  const [step, setStep] = useState<Step>('review');
  const [selectedId, setSelectedId] = useState(eligible[0]?.id ?? '');
  const [cart, setCart] = useState<CartLine[]>(() => visitLines(eligible[0]));
  const [discountCode, setDiscountCode] = useState('');
  const [codeApplied, setCodeApplied] = useState(false);
  const [membershipCredit, setMembershipCredit] = useState(false);
  const [tipOption, setTipOption] = useState<TipOption>('15%');
  const [method, setMethod] = useState<MethodKey | null>(null);
  const [paying, setPaying] = useState(false);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const selected = eligible.find((appointment) => appointment.id === selectedId) ?? null;
  const chosenMethod = METHODS.find((option) => option.key === method) ?? null;
  const chosenMethodAvailable = chosenMethod
    ? isStaffTenderAvailable(chosenMethod.key, isDemo)
    : false;

  const {
    subtotalCents, discountCents, taxCents, baseCents, tipCents, totalCents,
    cardChargeCents, extrasCents,
  } = registerTotals({
    cart,
    codeApplied,
    membershipCredit,
    tipRate: promptForTip ? TIP_RATES[tipOption] : 0,
    visitBalanceCents: selected ? selected.balanceCents : null,
  });

  function selectVisit(appointment: PortalAppointment) {
    setSelectedId(appointment.id);
    setCart((current) => selectVisitLines(current, appointment));
  }

  function addLine(name: string, priceCents: number) {
    setCart((current) => addCartLine(current, name, priceCents));
  }

  function changeQty(id: string, delta: number) {
    setCart((current) => changeCartQty(current, id, delta));
  }

  function removeLine(id: string) {
    setCart((current) => removeCartLine(current, id));
  }

  function resetSale() {
    setCart([]);
    setSelectedId('');
    setDiscountCode('');
    setCodeApplied(false);
    setMembershipCredit(false);
    setTipOption('15%');
    setMethod(null);
    setPaying(false);
    setReceipt(null);
    setNotice(null);
    setStep('review');
  }

  function finish(chargedCents: number, methodLabel: string, providerCharged: boolean) {
    setReceipt({
      chargedCents,
      methodLabel,
      tipCents,
      extrasCents: chargedCents === totalCents ? 0 : extrasCents,
      providerCharged,
    });
    setStep('complete');
  }

  async function collectPayment() {
    if (!chosenMethod) return;

    if (!chosenMethodAvailable) {
      Alert.alert(
        'Tender unavailable in live mode',
        'This tender needs its specific live provider or settlement ledger. No payment or visit status was changed.',
      );
      return;
    }

    if (!chosenMethod.card) {
      // Cash, check, gift certificate, and store credit are collected in the
      // room; the ticket is simply closed against the visit when there is one.
      if (selected) {
        try {
          await onComplete(selected.id);
        } catch (checkoutError) {
          Alert.alert(
            'Checkout could not be completed',
            checkoutError instanceof Error ? checkoutError.message : 'No card was charged.',
          );
          return;
        }
      }
      setNotice(null);
      finish(totalCents, chosenMethod.label, false);
      return;
    }

    if (!selected) {
      Alert.alert(
        'Card payment needs a visit',
        'Select a visit to charge a card, or take this sale with cash, check, gift certificate, or store credit.',
      );
      return;
    }

    if (isDemo) {
      setNotice('Preview checkout completed. No card was charged.');
      await onComplete(selected.id);
      finish(cardChargeCents, chosenMethod.label, false);
      return;
    }

    setPaying(true);
    setNotice(null);
    try {
      const payment = await mobileApi.createStaffCheckout({
        appointmentId: selected.id,
        tipCents,
        idempotencyKey: `checkout-${selected.id}-${tipCents}`,
      });
      const initialized = await stripe.initPaymentSheet({
        merchantDisplayName: 'Coffee Story',
        paymentIntentClientSecret: payment.paymentIntent,
        customerEphemeralKeySecret: payment.ephemeralKey,
        customerId: payment.customer,
        returnURL: 'coffeestory://stripe-redirect',
      });
      if (initialized.error) throw new Error(initialized.error.message);
      const presented = await stripe.presentPaymentSheet();
      if (presented.error) throw new Error(presented.error.message);
      setNotice('Payment received. Rewards will post after secure confirmation.');
      await onComplete(selected.id);
      finish(cardChargeCents, chosenMethod.label, true);
    } catch (checkoutError) {
      Alert.alert(
        'Checkout could not be completed',
        checkoutError instanceof Error ? checkoutError.message : 'No card was charged.',
      );
    } finally {
      setPaying(false);
    }
  }

  return (
    <CollapsingScreen title="Checkout" eyebrow="Point of sale" onBack={onBack} keyboardShouldPersistTaps="handled">
      <Body muted>{stepSubtitle(step)}</Body>
      {step === 'complete' ? null : <StepIndicator step={step} />}

      {step === 'review' ? (
        <CartSection
          eligible={eligible}
          selected={selected}
          onSelectVisit={selectVisit}
          cart={cart}
          onAddLine={addLine}
          onChangeQty={changeQty}
          onRemoveLine={removeLine}
          discountCode={discountCode}
          onDiscountCodeChange={setDiscountCode}
          onApplyDiscount={() => setCodeApplied(discountCode.trim().length > 0)}
          membershipCredit={membershipCredit}
          onToggleMembershipCredit={() => setMembershipCredit((current) => !current)}
          subtotalCents={subtotalCents}
          discountCents={discountCents}
          taxCents={taxCents}
          baseCents={baseCents}
          onContinue={() => setStep('payment')}
          onResetSale={resetSale}
        />
      ) : null}

      {step === 'payment' ? (
        <PaymentSection
          selected={selected}
          promptForTip={promptForTip}
          baseCents={baseCents}
          totalCents={totalCents}
          tipCents={tipCents}
          extrasCents={extrasCents}
          tipOption={tipOption}
          onTipChange={setTipOption}
          method={method}
          onMethodChange={setMethod}
          chosenMethod={chosenMethod}
          chosenMethodAvailable={chosenMethodAvailable}
          isDemo={isDemo}
          paying={paying}
          onBack={() => setStep('review')}
          onCollectPayment={() => void collectPayment()}
        />
      ) : null}

      {step === 'complete' && receipt ? (
        <ReceiptSection receipt={receipt} notice={notice} onResetSale={resetSale} />
      ) : null}
    </CollapsingScreen>
  );
}
