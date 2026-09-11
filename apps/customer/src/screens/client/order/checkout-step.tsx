/**
 * Checkout: the itemised receipt, the tip, the payment method, and the button
 * that places the order.
 *
 * Every tax authority is printed on its own line with its rate, and each row
 * is rounded on its own in `features/order/totals.ts` so what the guest reads
 * adds up to what they are charged.
 */
import { Text } from 'react-native';

import { CollapsingScreen } from '@/components/collapsing-screen';
import {
  ActionButton,
  RewardsBanner,
  StickyActionBar,
  useStickyBarClearance,
} from '@/components/order/order-chrome';
import { formatMoney, type OrderTotals } from '@platform/domain';
import { POINTS_LABEL } from '@/features/rewards/presentation';
import { AppIcon, useTokens as useBrandTokens } from '@platform/ui';

import { CheckoutPayment } from './checkout-payment';
import { CheckoutReceipt } from './checkout-receipt';
import { createStyles } from './checkout-step-styles';
import type {
  CheckoutPaymentMethod,
  RedeemControl,
  StoredValueControl,
} from './checkout-types';

export function CheckoutStep({
  totals,
  pointsEarned,
  payment,
  paymentLoading,
  paying,
  simulated,
  error,
  redeem,
  storedValue,
  cardChargeCents,
  onBack,
  onTipChange,
  onPlaceOrder,
  onManagePayment,
}: {
  totals: OrderTotals;
  pointsEarned: number;
  payment: CheckoutPaymentMethod | null;
  paymentLoading: boolean;
  paying: boolean;
  /** True when the charge is simulated — Demo mode or Expo Go. */
  simulated: boolean;
  error: string | null;
  /** Loyalty redemption control; null hides it (no balance, or feature off). */
  redeem?: RedeemControl | null;
  /** Gift/stored-value tender; null hides it. */
  storedValue?: StoredValueControl | null;
  /** What the card is actually charged once stored value is applied. */
  cardChargeCents?: number;
  onBack: () => void;
  onTipChange: (cents: number) => void;
  onPlaceOrder: () => void;
  onManagePayment: () => void;
}) {
  const tokens = useBrandTokens();
  const styles = createStyles(tokens);
  const clearance = useStickyBarClearance(tokens.spacing.xxl);
  const applePay = payment?.kind === 'apple-pay';
  const canPay = payment !== null && !paying;

  return (
    <>
      <CollapsingScreen
        title="Checkout"
        onBack={onBack}
        backLabel="Bag"
        keyboardShouldPersistTaps="handled"
        style={styles.page}
        headerBackgroundColor={tokens.surface}
        headerBorderColor={tokens.surface}
        contentContainerStyle={[styles.content, { paddingBottom: clearance }]}
      >
        <CheckoutReceipt
          cardChargeCents={cardChargeCents}
          onTipChange={onTipChange}
          storedValue={storedValue}
          totals={totals}
        />
        <CheckoutPayment
          onManagePayment={onManagePayment}
          payment={payment}
          paymentLoading={paymentLoading}
          redeem={redeem}
          storedValue={storedValue}
        />

        <RewardsBanner label={`Earn ${pointsEarned} ${POINTS_LABEL} on this order`} />

        {payment?.kind === 'pay-at-pickup' ? (
          <Text style={styles.simulated}>
            Nothing is charged now — pay at the counter when you pick up.
          </Text>
        ) : simulated ? (
          <Text style={styles.simulated}>
            Demo mode simulates the charge. No card is contacted and no money moves.
          </Text>
        ) : null}
        {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      </CollapsingScreen>

      <StickyActionBar>
        <ActionButton
          label={paying ? 'Placing your order…' : applePay ? 'Pay with Apple Pay' : 'Place Order'}
          value={paying ? undefined : formatMoney(cardChargeCents ?? totals.totalCents)}
          disabled={!canPay}
          onPress={onPlaceOrder}
          accessibilityHint={payment ? undefined : 'Add a payment method first'}
          leading={applePay ? <AppIcon name="applelogo" size={18} tintColor={tokens.surfaceElevated} /> : undefined}
        />
      </StickyActionBar>
    </>
  );
}

export type { CheckoutPaymentMethod } from './checkout-types';
