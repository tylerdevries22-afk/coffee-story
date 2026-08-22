/**
 * Checkout: the itemised receipt, the tip, the payment method, and the button
 * that places the order.
 *
 * Every tax authority is printed on its own line with its rate, and each row
 * is rounded on its own in `features/order/totals.ts` so what the guest reads
 * adds up to what they are charged.
 */
import * as Haptics from 'expo-haptics';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { CollapsingScreen } from '@/components/collapsing-screen';
import { AppIcon } from '@/components/icon';
import {
  ActionButton,
  RewardsBanner,
  Skeleton,
  StickyActionBar,
  useStickyBarClearance,
} from '@/components/order/order-chrome';
import { formatMoney, formatRate } from '@/features/money';
import { TIP_PRESETS_CENTS, type OrderTotals } from '@/features/order/totals';
import { HEART_POINTS_LABEL } from '@/features/rewards/presentation';
import { choiceState } from '@/lib/a11y-state';
import { colors, fonts, radius, spacing } from '@/theme/tokens';
import type { PaymentMethod } from '@/types/domain';

export type CheckoutPaymentMethod =
  | { kind: 'apple-pay' }
  | { kind: 'card'; method: PaymentMethod };

export function CheckoutStep({
  totals,
  pointsEarned,
  payment,
  paymentLoading,
  paying,
  simulated,
  error,
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
  onBack: () => void;
  onTipChange: (cents: number) => void;
  onPlaceOrder: () => void;
  onManagePayment: () => void;
}) {
  const clearance = useStickyBarClearance(spacing.xl);
  const [customTipOpen, setCustomTipOpen] = useState(false);
  const [customTip, setCustomTip] = useState('');
  const isPreset = TIP_PRESETS_CENTS.includes(totals.tipCents);

  const applePay = payment?.kind === 'apple-pay';
  const canPay = payment !== null && !paying;

  function chooseTip(cents: number) {
    void Haptics.selectionAsync().catch(() => undefined);
    setCustomTipOpen(false);
    onTipChange(cents);
  }

  function applyCustomTip(raw: string) {
    setCustomTip(raw);
    const dollars = Number.parseFloat(raw.replace(/[^0-9.]/g, ''));
    onTipChange(Number.isFinite(dollars) ? Math.round(dollars * 100) : 0);
  }

  return (
    <>
      <CollapsingScreen
        title="Checkout"
        onBack={onBack}
        backLabel="Bag"
        keyboardShouldPersistTaps="handled"
        style={styles.page}
        headerBackgroundColor={colors.brand200}
        headerBorderColor={colors.brand200}
        contentContainerStyle={[styles.content, { paddingBottom: clearance }]}
      >
        <View style={styles.card}>
          <Text accessibilityRole="header" style={styles.cardTitle}>Order Details</Text>
          <ReceiptRow label="Subtotal" value={formatMoney(totals.subtotalCents)} />
          {totals.deliveryFeeCents > 0 ? (
            <ReceiptRow label="Delivery" value={formatMoney(totals.deliveryFeeCents)} />
          ) : null}
          {totals.discountCents > 0 ? (
            <ReceiptRow label="Discount" value={`-${formatMoney(totals.discountCents)}`} />
          ) : null}
          {totals.taxRows.map((row) => (
            <ReceiptRow
              key={row.id}
              label={`${row.label} (${formatRate(row.rate)})`}
              value={formatMoney(row.amountCents)}
            />
          ))}
          <ReceiptRow label="Tip" value={formatMoney(totals.tipCents)} />

          <View accessibilityRole="radiogroup" style={styles.tipRow}>
            {TIP_PRESETS_CENTS.map((preset) => (
              <TipChip
                key={preset}
                label={formatMoney(preset)}
                selected={totals.tipCents === preset && !customTipOpen}
                onPress={() => chooseTip(preset)}
              />
            ))}
            <TipChip
              label="Other"
              selected={customTipOpen || (!isPreset && totals.tipCents > 0)}
              onPress={() => {
                void Haptics.selectionAsync().catch(() => undefined);
                setCustomTipOpen(true);
              }}
            />
          </View>
          {customTipOpen ? (
            <TextInput
              accessibilityLabel="Custom tip amount in dollars"
              value={customTip}
              onChangeText={applyCustomTip}
              keyboardType="decimal-pad"
              placeholder="0.00"
              placeholderTextColor={colors.ink400}
              autoFocus
              style={styles.tipInput}
            />
          ) : null}
          <Text style={styles.tipCaption}>100% of tips go to the baristas.</Text>

          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Total</Text>
            <Text style={styles.totalValue}>{formatMoney(totals.totalCents)}</Text>
          </View>
        </View>

        <View style={styles.card}>
          <Text accessibilityRole="header" style={styles.cardTitle}>Payment</Text>
          {paymentLoading ? (
            <View style={styles.paymentSkeleton}>
              <Skeleton height={56} radius={radius.md} />
            </View>
          ) : (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={
                payment
                  ? `Payment method: ${describePayment(payment)}. Change`
                  : 'Add a payment method'
              }
              onPress={onManagePayment}
              style={({ pressed }) => [styles.paymentRow, pressed && styles.pressed]}
            >
              <AppIcon
                name={applePay ? 'applelogo' : 'creditcard.fill'}
                size={20}
                tintColor={colors.ink900}
              />
              <Text style={styles.paymentLabel}>
                {payment ? describePayment(payment) : 'Add a payment method'}
              </Text>
              {payment ? <View style={styles.defaultChip}><Text style={styles.defaultChipText}>Default</Text></View> : null}
              <AppIcon name="chevron.right" size={16} tintColor={colors.ink400} />
            </Pressable>
          )}

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Add a gift card, voucher, or promo code"
            onPress={onManagePayment}
            style={({ pressed }) => [styles.promoRow, pressed && styles.pressed]}
          >
            <AppIcon name="tag" size={16} tintColor={colors.ink700} />
            <Text style={styles.promoLabel}>Gift Card, Voucher, Promo Code</Text>
          </Pressable>

          <Text style={styles.legal}>
            By placing this order you agree to our Terms &amp; Conditions and confirm you have read our
            Privacy Policy.
          </Text>
          <Text style={styles.legalQuiet}>Powered by Stripe</Text>
        </View>

        <RewardsBanner label={`Earn ${pointsEarned} ${HEART_POINTS_LABEL} on this order`} />

        {simulated ? (
          <Text style={styles.simulated}>
            Demo mode simulates the charge. No card is contacted and no money moves.
          </Text>
        ) : null}
        {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      </CollapsingScreen>

      <StickyActionBar>
        <ActionButton
          label={paying ? 'Placing your order…' : applePay ? 'Pay with Apple Pay' : 'Place Order'}
          value={paying ? undefined : formatMoney(totals.totalCents)}
          disabled={!canPay}
          onPress={onPlaceOrder}
          accessibilityHint={payment ? undefined : 'Add a payment method first'}
          leading={applePay ? <AppIcon name="applelogo" size={18} tintColor={colors.white} /> : undefined}
        />
      </StickyActionBar>
    </>
  );
}

function describePayment(payment: CheckoutPaymentMethod): string {
  return payment.kind === 'apple-pay'
    ? 'Apple Pay'
    : `${payment.method.brand} ending ${payment.method.last4}`;
}

function ReceiptRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.receiptRow}>
      <Text style={styles.receiptLabel}>{label}</Text>
      <Text style={styles.receiptValue}>{value}</Text>
    </View>
  );
}

function TipChip({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={label === 'Other' ? 'Other tip amount' : `${label} tip`}
      {...choiceState(selected)}
      onPress={onPress}
      style={({ pressed }) => [styles.tipChip, selected && styles.tipChipSelected, pressed && styles.pressed]}
    >
      <Text style={[styles.tipChipText, selected && styles.tipChipTextSelected]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  page: { backgroundColor: colors.brand200 },
  content: { gap: spacing.md },
  pressed: { opacity: 0.72 },

  card: { borderRadius: radius.lg, backgroundColor: colors.white, padding: spacing.lg, gap: spacing.sm },
  cardTitle: { color: colors.ink900, fontFamily: fonts.sansBold, fontSize: 20, marginBottom: spacing.xs },

  receiptRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing.md },
  receiptLabel: { flex: 1, color: colors.ink600, fontFamily: fonts.sans, fontSize: 14, lineHeight: 20 },
  receiptValue: { color: colors.ink700, fontFamily: fonts.sansMedium, fontSize: 14, lineHeight: 20 },

  tipRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  tipChip: {
    flex: 1,
    minHeight: 46,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.ink200,
    backgroundColor: colors.white,
  },
  tipChipSelected: { borderColor: colors.brand700, backgroundColor: colors.brand50 },
  tipChipText: { color: colors.ink700, fontFamily: fonts.sansMedium, fontSize: 14 },
  tipChipTextSelected: { color: colors.brand700, fontFamily: fonts.sansBold },
  tipInput: {
    minHeight: 52,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.brand700,
    backgroundColor: colors.white,
    color: colors.ink900,
    fontFamily: fonts.sans,
    fontSize: 16,
    paddingHorizontal: spacing.md,
  },
  tipCaption: { color: colors.ink500, fontFamily: fonts.sans, fontSize: 12 },

  totalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.ink200,
  },
  totalLabel: { color: colors.ink900, fontFamily: fonts.sansBold, fontSize: 20 },
  totalValue: { color: colors.ink900, fontFamily: fonts.sansBold, fontSize: 20 },

  paymentSkeleton: { paddingVertical: spacing.xs },
  paymentRow: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.ink200,
  },
  paymentLabel: { flex: 1, color: colors.ink900, fontFamily: fonts.sansMedium, fontSize: 15 },
  defaultChip: { paddingHorizontal: spacing.sm, paddingVertical: 3, borderRadius: radius.pill, backgroundColor: colors.brand100 },
  defaultChipText: { color: colors.brand700, fontFamily: fonts.sansMedium, fontSize: 11 },

  promoRow: {
    minHeight: 46,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    backgroundColor: colors.warm,
  },
  promoLabel: { color: colors.ink700, fontFamily: fonts.sansMedium, fontSize: 13 },

  legal: { color: colors.ink500, fontFamily: fonts.sans, fontSize: 11, lineHeight: 16, fontStyle: 'italic' },
  legalQuiet: { color: colors.ink400, fontFamily: fonts.sans, fontSize: 11, fontStyle: 'italic' },

  simulated: { color: colors.ink600, fontFamily: fonts.sans, fontSize: 12, lineHeight: 18 },
  error: { color: colors.danger, fontFamily: fonts.sansMedium, fontSize: 13, lineHeight: 19 },
});
