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
import { formatMoney, formatRate } from '@platform/domain';
import { TIP_PRESETS_CENTS, type OrderTotals , PaymentMethod } from '@platform/domain';
import { POINTS_LABEL } from '@/features/rewards/presentation';
import { choiceState, toggleState } from '@platform/ui';
import { useTokens as useBrandTokens, type BrandTokens } from '@platform/ui';

export type CheckoutPaymentMethod =
  | { kind: 'apple-pay' }
  | { kind: 'card'; method: PaymentMethod }
  /** Live tender until the brand connects card payments: settle at the counter. */
  | { kind: 'pay-at-pickup' };

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
  redeem?: {
    availableCents: number;
    appliedCents: number;
    pointsCharged: number;
    pointsName: string;
    onToggle: () => void;
  } | null;
  /** Gift/stored-value tender; null hides it. */
  storedValue?: {
    balanceCents: number;
    appliedCents: number;
    enabled: boolean;
    onToggle: () => void;
  } | null;
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
  const [customTipOpen, setCustomTipOpen] = useState(false);
  const [customTip, setCustomTip] = useState('');
  const isPreset = TIP_PRESETS_CENTS.includes(totals.tipCents);

  const applePay = payment?.kind === 'apple-pay';
  const canPay = payment !== null && !paying;

  function chooseTip(cents: number) {
    void Haptics.selectionAsync().catch(() => undefined);
    setCustomTipOpen(false);
    // Cleared, or the field reopens showing an amount that is no longer the
    // one being charged -- a guest looking at "10" while the total carries $2.
    setCustomTip('');
    onTipChange(cents);
  }

  function openCustomTip() {
    void Haptics.selectionAsync().catch(() => undefined);
    // Seeded from the tip actually in force, so opening the field never shows
    // a blank box beside a Total that already includes a preset tip.
    setCustomTip(totals.tipCents > 0 ? (totals.tipCents / 100).toFixed(2) : '');
    setCustomTipOpen(true);
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
        headerBackgroundColor={tokens.surface}
        headerBorderColor={tokens.surface}
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
              onPress={openCustomTip}
            />
          </View>
          {customTipOpen ? (
            <TextInput
              accessibilityLabel="Custom tip amount in dollars"
              value={customTip}
              onChangeText={applyCustomTip}
              keyboardType="decimal-pad"
              placeholder="0.00"
              placeholderTextColor={tokens.textMuted}
              autoFocus
              style={styles.tipInput}
            />
          ) : null}
          <Text style={styles.tipCaption}>100% of tips go to the baristas.</Text>

          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Total</Text>
            <Text style={styles.totalValue}>{formatMoney(totals.totalCents)}</Text>
          </View>
          {storedValue && storedValue.appliedCents > 0 ? (
            <>
              <ReceiptRow label="Gift balance applied" value={`-${formatMoney(storedValue.appliedCents)}`} />
              <ReceiptRow label="Card charge" value={formatMoney(cardChargeCents ?? totals.totalCents)} />
            </>
          ) : null}
        </View>

        <View style={styles.card}>
          <Text accessibilityRole="header" style={styles.cardTitle}>Payment</Text>
          {paymentLoading ? (
            <View style={styles.paymentSkeleton}>
              <Skeleton height={56} radius={tokens.radius.lg} />
            </View>
          ) : payment?.kind === 'pay-at-pickup' ? (
            // Nothing to manage: the tender is the counter. A pressable row
            // would open a payments screen live mode does not have.
            <View accessibilityLabel="Payment method: pay at the counter when you pick up" style={styles.paymentRow}>
              <AppIcon name="cup.and.saucer.fill" size={20} tintColor={tokens.textPrimary} />
              <Text style={styles.paymentLabel}>{describePayment(payment)}</Text>
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
                tintColor={tokens.textPrimary}
              />
              <Text style={styles.paymentLabel}>
                {payment ? describePayment(payment) : 'Add a payment method'}
              </Text>
              {payment ? <View style={styles.defaultChip}><Text style={styles.defaultChipText}>Default</Text></View> : null}
              <AppIcon name="chevron.right" size={16} tintColor={tokens.textMuted} />
            </Pressable>
          )}

          {redeem && (redeem.availableCents > 0 || redeem.appliedCents > 0) ? (
            <Pressable
              accessibilityRole="switch"
              {...toggleState(redeem.appliedCents > 0)}
              accessibilityLabel={
                redeem.appliedCents > 0
                  ? `Redeeming ${formatMoney(redeem.appliedCents)} for ${redeem.pointsCharged} ${redeem.pointsName}. Turn off`
                  : `Redeem ${redeem.pointsName}: up to ${formatMoney(redeem.availableCents)} available`
              }
              onPress={redeem.onToggle}
              style={({ pressed }) => [styles.promoRow, pressed && styles.pressed]}
            >
              <AppIcon name="star.fill" size={16} tintColor={redeem.appliedCents > 0 ? tokens.success : tokens.textPrimary} />
              <Text style={styles.promoLabel}>
                {redeem.appliedCents > 0
                  ? `Redeeming ${formatMoney(redeem.appliedCents)} (${redeem.pointsCharged} ${redeem.pointsName})`
                  : `Redeem up to ${formatMoney(redeem.availableCents)} of ${redeem.pointsName}`}
              </Text>
              <Text style={styles.toggleHint}>{redeem.appliedCents > 0 ? 'On' : 'Off'}</Text>
            </Pressable>
          ) : null}

          {storedValue && storedValue.balanceCents > 0 ? (
            <Pressable
              accessibilityRole="switch"
              {...toggleState(storedValue.enabled)}
              accessibilityLabel={
                storedValue.enabled
                  ? `Gift balance covering ${formatMoney(storedValue.appliedCents)}. Turn off`
                  : `Use gift balance: ${formatMoney(storedValue.balanceCents)} available`
              }
              onPress={storedValue.onToggle}
              style={({ pressed }) => [styles.promoRow, pressed && styles.pressed]}
            >
              <AppIcon name="giftcard" size={16} tintColor={storedValue.enabled ? tokens.success : tokens.textPrimary} />
              <Text style={styles.promoLabel}>
                {storedValue.enabled
                  ? `Gift balance covering ${formatMoney(storedValue.appliedCents)}`
                  : `Use gift balance (${formatMoney(storedValue.balanceCents)})`}
              </Text>
              <Text style={styles.toggleHint}>{storedValue.enabled ? 'On' : 'Off'}</Text>
            </Pressable>
          ) : null}

          {payment?.kind !== 'pay-at-pickup' ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Add a gift card, voucher, or promo code"
              onPress={onManagePayment}
              style={({ pressed }) => [styles.promoRow, pressed && styles.pressed]}
            >
              <AppIcon name="tag" size={16} tintColor={tokens.textPrimary} />
              <Text style={styles.promoLabel}>Gift Card, Voucher, Promo Code</Text>
            </Pressable>
          ) : null}

          <Text style={styles.legal}>
            By placing this order you agree to our Terms &amp; Conditions and confirm you have read our
            Privacy Policy.
          </Text>
        </View>

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

function describePayment(payment: CheckoutPaymentMethod): string {
  if (payment.kind === 'pay-at-pickup') return 'Pay at the counter';
  return payment.kind === 'apple-pay'
    ? 'Apple Pay'
    : `${payment.method.brand} ending ${payment.method.last4}`;
}

function ReceiptRow({ label, value }: { label: string; value: string }) {
  const tokens = useBrandTokens();
  const styles = createStyles(tokens);
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
  const tokens = useBrandTokens();
  const styles = createStyles(tokens);
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

const createStyles = (tokens: BrandTokens) => StyleSheet.create({
  page: { backgroundColor: tokens.surface },
  content: { gap: tokens.spacing.lg },
  pressed: { opacity: 0.72 },

  card: { borderRadius: tokens.radius.lg, backgroundColor: tokens.surfaceElevated, padding: tokens.spacing.xl, gap: tokens.spacing.md },
  cardTitle: { color: tokens.textPrimary, fontFamily: tokens.fontBody, fontSize: 20, marginBottom: tokens.spacing.sm },

  receiptRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: tokens.spacing.lg },
  receiptLabel: { flex: 1, color: tokens.textMuted, fontFamily: tokens.fontBody, fontSize: 14, lineHeight: 20 },
  receiptValue: { color: tokens.textPrimary, fontFamily: tokens.fontBody, fontSize: 14, lineHeight: 20 },

  tipRow: { flexDirection: 'row', gap: tokens.spacing.md, marginTop: tokens.spacing.md },
  tipChip: {
    flex: 1,
    minHeight: 46,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: tokens.radius.lg,
    borderWidth: 1,
    borderColor: tokens.secondary,
    backgroundColor: tokens.surfaceElevated,
  },
  tipChipSelected: { borderColor: tokens.primary, backgroundColor: tokens.surface },
  tipChipText: { color: tokens.textPrimary, fontFamily: tokens.fontBody, fontSize: 14 },
  tipChipTextSelected: { color: tokens.primary, fontFamily: tokens.fontBody },
  tipInput: {
    minHeight: 52,
    borderRadius: tokens.radius.lg,
    borderWidth: 1,
    borderColor: tokens.primary,
    backgroundColor: tokens.surfaceElevated,
    color: tokens.textPrimary,
    fontFamily: tokens.fontBody,
    fontSize: 16,
    paddingHorizontal: tokens.spacing.lg,
  },
  tipCaption: { color: tokens.textMuted, fontFamily: tokens.fontBody, fontSize: 12 },

  totalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: tokens.spacing.md,
    paddingTop: tokens.spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: tokens.secondary,
  },
  totalLabel: { color: tokens.textPrimary, fontFamily: tokens.fontBody, fontSize: 20 },
  totalValue: { color: tokens.textPrimary, fontFamily: tokens.fontBody, fontSize: 20 },

  paymentSkeleton: { paddingVertical: tokens.spacing.sm },
  paymentRow: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: tokens.spacing.md,
    paddingHorizontal: tokens.spacing.lg,
    borderRadius: tokens.radius.lg,
    borderWidth: 1,
    borderColor: tokens.secondary,
  },
  paymentLabel: { flex: 1, color: tokens.textPrimary, fontFamily: tokens.fontBody, fontSize: 15 },
  defaultChip: { paddingHorizontal: tokens.spacing.md, paddingVertical: 3, borderRadius: tokens.radius.pill, backgroundColor: tokens.surface },
  defaultChipText: { color: tokens.primary, fontFamily: tokens.fontBody, fontSize: 11 },

  promoRow: {
    minHeight: 46,
    flexDirection: 'row',
    alignItems: 'center',
    gap: tokens.spacing.md,
    alignSelf: 'flex-start',
    paddingHorizontal: tokens.spacing.lg,
    borderRadius: tokens.radius.pill,
    backgroundColor: tokens.surface,
  },
  toggleHint: { color: tokens.textMuted, fontFamily: tokens.fontBody, fontSize: 13 },
  promoLabel: { color: tokens.textPrimary, fontFamily: tokens.fontBody, fontSize: 13 },

  legal: { color: tokens.textMuted, fontFamily: tokens.fontBody, fontSize: 11, lineHeight: 16, fontStyle: 'italic' },
  legalQuiet: { color: tokens.textMuted, fontFamily: tokens.fontBody, fontSize: 11, fontStyle: 'italic' },

  simulated: { color: tokens.textMuted, fontFamily: tokens.fontBody, fontSize: 12, lineHeight: 18 },
  error: { color: tokens.danger, fontFamily: tokens.fontBody, fontSize: 13, lineHeight: 19 },
});
