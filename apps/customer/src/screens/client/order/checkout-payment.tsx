import { Pressable, Text, View } from 'react-native';

import { Skeleton } from '@/components/order/order-chrome';
import { formatMoney } from '@platform/domain';
import { AppIcon, toggleState, useTokens as useBrandTokens } from '@platform/ui';

import { createStyles } from './checkout-step-styles';
import type { CheckoutPaymentMethod, RedeemControl, StoredValueControl } from './checkout-types';

export function CheckoutPayment({
  onManagePayment,
  payment,
  paymentLoading,
  redeem,
  storedValue,
}: {
  onManagePayment: () => void;
  payment: CheckoutPaymentMethod | null;
  paymentLoading: boolean;
  redeem?: RedeemControl | null;
  storedValue?: StoredValueControl | null;
}) {
  const tokens = useBrandTokens();
  const styles = createStyles(tokens);
  const applePay = payment?.kind === 'apple-pay';
  return (
    <View style={styles.card}>
      <Text accessibilityRole="header" style={styles.cardTitle}>Payment</Text>
      {paymentLoading ? (
        <View style={styles.paymentSkeleton}><Skeleton height={56} radius={tokens.radius.lg} /></View>
      ) : payment?.kind === 'pay-at-pickup' ? (
        <View accessibilityLabel="Payment method: pay at the counter when you pick up" style={styles.paymentRow}>
          <AppIcon name="creditcard.fill" size={20} tintColor={tokens.textPrimary} />
          <Text style={styles.paymentLabel}>{describePayment(payment)}</Text>
        </View>
      ) : (
        <Pressable accessibilityRole="button" accessibilityLabel={payment ? `Payment method: ${describePayment(payment)}. Change` : 'Add a payment method'} onPress={onManagePayment} style={({ pressed }) => [styles.paymentRow, pressed && styles.pressed]}>
          <AppIcon name={applePay ? 'applelogo' : 'creditcard.fill'} size={20} tintColor={tokens.textPrimary} />
          <Text style={styles.paymentLabel}>{payment ? describePayment(payment) : 'Add a payment method'}</Text>
          {payment ? <View style={styles.defaultChip}><Text style={styles.defaultChipText}>Default</Text></View> : null}
          <AppIcon name="chevron.right" size={16} tintColor={tokens.textMuted} />
        </Pressable>
      )}
      {redeem && (redeem.availableCents > 0 || redeem.appliedCents > 0) ? (
        <Pressable accessibilityRole="switch" {...toggleState(redeem.appliedCents > 0)} accessibilityLabel={redeem.appliedCents > 0 ? `Redeeming ${formatMoney(redeem.appliedCents)} for ${redeem.pointsCharged} ${redeem.pointsName}. Turn off` : `Redeem ${redeem.pointsName}: up to ${formatMoney(redeem.availableCents)} available`} onPress={redeem.onToggle} style={({ pressed }) => [styles.promoRow, pressed && styles.pressed]}>
          <AppIcon name="star.fill" size={16} tintColor={redeem.appliedCents > 0 ? tokens.success : tokens.textPrimary} />
          <Text style={styles.promoLabel}>{redeem.appliedCents > 0 ? `Redeeming ${formatMoney(redeem.appliedCents)} (${redeem.pointsCharged} ${redeem.pointsName})` : `Redeem up to ${formatMoney(redeem.availableCents)} of ${redeem.pointsName}`}</Text>
          <Text style={styles.toggleHint}>{redeem.appliedCents > 0 ? 'On' : 'Off'}</Text>
        </Pressable>
      ) : null}
      {storedValue && storedValue.balanceCents > 0 ? (
        <Pressable accessibilityRole="switch" {...toggleState(storedValue.enabled)} accessibilityLabel={storedValue.enabled ? `Gift balance covering ${formatMoney(storedValue.appliedCents)}. Turn off` : `Use gift balance: ${formatMoney(storedValue.balanceCents)} available`} onPress={storedValue.onToggle} style={({ pressed }) => [styles.promoRow, pressed && styles.pressed]}>
          <AppIcon name="giftcard" size={16} tintColor={storedValue.enabled ? tokens.success : tokens.textPrimary} />
          <Text style={styles.promoLabel}>{storedValue.enabled ? `Gift balance covering ${formatMoney(storedValue.appliedCents)}` : `Use gift balance (${formatMoney(storedValue.balanceCents)})`}</Text>
          <Text style={styles.toggleHint}>{storedValue.enabled ? 'On' : 'Off'}</Text>
        </Pressable>
      ) : null}
      {payment?.kind !== 'pay-at-pickup' ? (
        <Pressable accessibilityRole="button" accessibilityLabel="Add a gift card, voucher, or promo code" onPress={onManagePayment} style={({ pressed }) => [styles.promoRow, pressed && styles.pressed]}>
          <AppIcon name="tag" size={16} tintColor={tokens.textPrimary} />
          <Text style={styles.promoLabel}>Gift Card, Voucher, Promo Code</Text>
        </Pressable>
      ) : null}
      <Text style={styles.legal}>By placing this order you agree to our Terms &amp; Conditions and confirm you have read our Privacy Policy.</Text>
    </View>
  );
}

function describePayment(payment: CheckoutPaymentMethod): string {
  if (payment.kind === 'pay-at-pickup') return 'Pay at the counter';
  return payment.kind === 'apple-pay' ? 'Apple Pay' : `${payment.method.brand} ending ${payment.method.last4}`;
}
