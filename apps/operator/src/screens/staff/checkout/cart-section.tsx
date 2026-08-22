import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import {
  Avatar,
  EmptyState,
  MoneyText,
  StatusBadge,
  WorkspaceCard,
  Chip,
} from '@/components/staff/workspace-ui';
import { Button } from '@/components/ui';
import { SERVICES } from '@/data/catalog';
import {
  ADD_ONS,
  GIFT_AMOUNTS_CENTS,
  MEMBERSHIP_CREDIT_CENTS,
  TAX_RATE,
  type CartLine,
} from '@/features/staff/pos-totals';
import { formatRate } from '@/features/money';
import { formatClockTime, formatMoney } from '@/features/staff/workspace';
import { colors, fonts, radius, spacing } from '@/theme/tokens';
import type { PortalAppointment } from '@/types/domain';
import { choiceState } from '@/lib/a11y-state';

const SERVICE_TILES = SERVICES.map((service) => ({
  id: service.id,
  name: service.name,
  minutes: service.durations[0]?.minutes ?? 60,
  priceCents: (service.durations[0]?.price ?? 0) * 100,
}));

export function CartSection({
  eligible,
  selected,
  onSelectVisit,
  cart,
  onAddLine,
  onChangeQty,
  onRemoveLine,
  discountCode,
  onDiscountCodeChange,
  onApplyDiscount,
  membershipCredit,
  onToggleMembershipCredit,
  subtotalCents,
  discountCents,
  taxCents,
  baseCents,
  onContinue,
  onResetSale,
}: {
  eligible: PortalAppointment[];
  selected: PortalAppointment | null;
  onSelectVisit: (appointment: PortalAppointment) => void;
  cart: CartLine[];
  onAddLine: (name: string, priceCents: number) => void;
  onChangeQty: (id: string, delta: number) => void;
  onRemoveLine: (id: string) => void;
  discountCode: string;
  onDiscountCodeChange: (value: string) => void;
  onApplyDiscount: () => void;
  membershipCredit: boolean;
  onToggleMembershipCredit: () => void;
  subtotalCents: number;
  discountCents: number;
  taxCents: number;
  baseCents: number;
  onContinue: () => void;
  onResetSale: () => void;
}) {
  return (
    <>
      {eligible.length ? (
        <WorkspaceCard title="Order">
          <View accessibilityRole="radiogroup" style={styles.visitList}>
            {eligible.map((appointment) => {
              const active = selected?.id === appointment.id;
              const clientName = appointment.clientName ?? 'Guest client';
              return (
                <Pressable
                  key={appointment.id}
                  accessibilityRole="radio"
                  {...choiceState(active)}
                  accessibilityLabel={`${clientName}, ${appointment.serviceName}, ${formatMoney(appointment.balanceCents)} balance`}
                  onPress={() => onSelectVisit(appointment)}
                  style={({ pressed }) => [styles.visitRow, active && styles.visitRowActive, pressed && styles.pressed]}
                >
                  <Avatar name={clientName} size={40} />
                  <View style={styles.visitCopy}>
                    <Text style={styles.visitName}>{clientName}</Text>
                    <Text style={styles.visitMeta}>
                      {`${formatClockTime(appointment.startsAt)} · ${appointment.serviceName}`}
                    </Text>
                    <StatusBadge status={appointment.status} />
                  </View>
                  <MoneyText cents={appointment.balanceCents} />
                </Pressable>
              );
            })}
          </View>
        </WorkspaceCard>
      ) : (
        <EmptyState
          title="No orders ready for checkout"
          message="Confirmed and pending visits appear here. You can still ring up services, add-ons, and gift certificates."
        />
      )}

      <WorkspaceCard title="Services">
        <View style={styles.grid}>
          {SERVICE_TILES.map((service) => (
              <Pressable
                key={service.id}
                accessibilityRole="button"
                accessibilityLabel={`Add ${service.name}, ${service.minutes} minutes, ${formatMoney(service.priceCents)}`}
                onPress={() => onAddLine(service.name, service.priceCents)}
                style={({ pressed }) => [styles.serviceTile, pressed && styles.pressed]}
              >
                <Text style={styles.tileName} numberOfLines={2}>{service.name}</Text>
                <Text style={styles.tileMeta}>{`${service.minutes} min`}</Text>
                <MoneyText cents={service.priceCents} style={styles.tilePrice} />
              </Pressable>
          ))}
        </View>
      </WorkspaceCard>

      <WorkspaceCard title="Add-ons">
        <View style={styles.addOnList}>
          {ADD_ONS.map((addOn) => (
            <Pressable
              key={addOn.name}
              accessibilityRole="button"
              accessibilityLabel={`Add ${addOn.name}, ${formatMoney(addOn.priceCents)}`}
              onPress={() => onAddLine(addOn.name, addOn.priceCents)}
              style={({ pressed }) => [styles.addOnRow, pressed && styles.pressed]}
            >
              <Text style={styles.addOnName}>{addOn.name}</Text>
              <Text style={styles.addOnPrice}>{`+${formatMoney(addOn.priceCents)}`}</Text>
            </Pressable>
          ))}
        </View>
      </WorkspaceCard>

      <WorkspaceCard title="Gift certificate">
        <View style={styles.giftRow}>
          {GIFT_AMOUNTS_CENTS.map((amountCents) => (
            <Chip
              key={amountCents}
              label={formatMoney(amountCents)}
              selected={false}
              onPress={() => onAddLine(`Gift certificate ${formatMoney(amountCents)}`, amountCents)}
            />
          ))}
        </View>
      </WorkspaceCard>

      <WorkspaceCard title="Order" action={cart.length ? 'Clear' : undefined} onAction={onResetSale}>
        {cart.length ? (
          <View style={styles.orderList}>
            {cart.map((line) => (
              <View key={line.id} style={styles.orderRow}>
                <View style={styles.orderCopy}>
                  <Text style={styles.orderName} numberOfLines={2}>{line.name}</Text>
                  <Text style={styles.orderMeta}>{`${formatMoney(line.priceCents)} each`}</Text>
                </View>
                <QtyButton label="Decrease" glyph="−" onPress={() => onChangeQty(line.id, -1)} />
                <Text style={styles.orderQty}>{line.qty}</Text>
                <QtyButton label="Increase" glyph="+" onPress={() => onChangeQty(line.id, 1)} />
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Remove"
                  hitSlop={6}
                  onPress={() => onRemoveLine(line.id)}
                  style={({ pressed }) => [styles.removeButton, pressed && styles.pressed]}
                >
                  <Text style={styles.removeGlyph}>✕</Text>
                </Pressable>
              </View>
            ))}
          </View>
        ) : (
          <Text style={styles.cartEmpty}>Cart is empty. Tap an item to begin.</Text>
        )}

        <View style={styles.rule} />

        <View style={styles.discountRow}>
          <TextInput
            accessibilityLabel="Discount code"
            value={discountCode}
            onChangeText={onDiscountCodeChange}
            placeholder="Discount code"
            placeholderTextColor={colors.ink400}
            autoCapitalize="characters"
            autoCorrect={false}
            style={styles.discountInput}
          />
          <Button label="Apply" variant="secondary" style={styles.applyButton} onPress={onApplyDiscount} />
        </View>

        <Pressable
          accessibilityRole="checkbox"
          accessibilityLabel={`Apply membership credit, minus ${formatMoney(MEMBERSHIP_CREDIT_CENTS)}`}
          {...choiceState(membershipCredit)}
          onPress={onToggleMembershipCredit}
          style={({ pressed }) => [styles.toggleRow, pressed && styles.pressed]}
        >
          <View style={[styles.checkbox, membershipCredit && styles.checkboxOn]}>
            {membershipCredit ? <Text style={styles.checkboxMark}>✓</Text> : null}
          </View>
          <Text style={styles.toggleLabel}>
            {`Apply membership credit (−${formatMoney(MEMBERSHIP_CREDIT_CENTS)})`}
          </Text>
        </Pressable>

        <View style={styles.rule} />

        <TotalRow label="Subtotal" value={formatMoney(subtotalCents)} />
        {discountCents > 0 ? <TotalRow label="Discount" value={`−${formatMoney(discountCents)}`} /> : null}
        {/* `formatRate`, not a rounded whole percent: the combined Aurora
            rate is 7.90%, and Math.round(7.9) printed "Tax (8%)" against a
            7.90% charge -- a receipt stating a rate the shop is not licensed
            to collect, off by 10c on a $110 ticket and more above that. */}
        <TotalRow label={`Tax (${formatRate(TAX_RATE)})`} value={formatMoney(taxCents)} />

        <Button
          testID="checkout-continue-to-payment"
          label={`Continue to payment · ${formatMoney(baseCents)}`}
          disabled={cart.length === 0}
          style={styles.continueButton}
          onPress={onContinue}
        />
      </WorkspaceCard>
    </>
  );
}

function QtyButton({ label, glyph, onPress }: { label: string; glyph: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={6}
      onPress={onPress}
      style={({ pressed }) => [styles.qtyButton, pressed && styles.pressed]}
    >
      <Text style={styles.qtyGlyph}>{glyph}</Text>
    </Pressable>
  );
}

function TotalRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.totalRow}>
      <Text style={styles.totalLabel}>{label}</Text>
      <Text style={styles.totalValue}>{value}</Text>
    </View>
  );
}

export const styles = StyleSheet.create({
  stepper: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  stepItem: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  stepDot: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.warm,
  },
  stepDotFilled: { backgroundColor: colors.brand600 },
  stepDotText: { color: colors.ink500, fontFamily: fonts.sansBold, fontSize: 11 },
  stepDotTextFilled: { color: colors.white },
  stepLabel: { color: colors.ink500, fontFamily: fonts.sansMedium, fontSize: 14 },
  stepLabelActive: { color: colors.ink900, fontFamily: fonts.sansBold },
  stepRule: { width: 28, height: 1, backgroundColor: colors.brand100, marginHorizontal: spacing.xs },

  visitList: { gap: spacing.sm },
  visitRow: {
    minHeight: 74,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.brand100,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  visitRowActive: { borderColor: colors.brand600, backgroundColor: colors.brand50 },
  visitCopy: { flex: 1, gap: 3 },
  visitName: { color: colors.ink900, fontFamily: fonts.sansBold, fontSize: 15 },
  visitMeta: { color: colors.ink500, fontFamily: fonts.sans, fontSize: 12 },

  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  serviceTile: {
    flexGrow: 1,
    flexBasis: '46%',
    minHeight: 92,
    gap: 3,
    justifyContent: 'center',
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.brand100,
    padding: spacing.md,
  },
  tileName: { color: colors.ink900, fontFamily: fonts.sansBold, fontSize: 14 },
  tileMeta: { color: colors.ink500, fontFamily: fonts.sans, fontSize: 12 },
  tilePrice: { color: colors.brand700, fontSize: 15 },

  addOnList: { gap: spacing.xs },
  addOnRow: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    borderRadius: radius.sm,
    backgroundColor: colors.warm,
    paddingHorizontal: spacing.md,
  },
  addOnName: { color: colors.ink900, fontFamily: fonts.sansMedium, fontSize: 14, flexShrink: 1 },
  addOnPrice: { color: colors.ink700, fontFamily: fonts.sansBold, fontSize: 14 },

  giftRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },

  orderList: { gap: 2 },
  orderRow: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    borderBottomWidth: 1,
    borderBottomColor: colors.brand100,
    paddingVertical: spacing.xs,
  },
  orderCopy: { flex: 1, gap: 2, paddingRight: spacing.xs },
  orderName: { color: colors.ink900, fontFamily: fonts.sansBold, fontSize: 14 },
  orderMeta: { color: colors.ink500, fontFamily: fonts.sans, fontSize: 12 },
  orderQty: { minWidth: 22, textAlign: 'center', color: colors.ink900, fontFamily: fonts.sansBold, fontSize: 14 },
  qtyButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.brand200,
  },
  qtyGlyph: { color: colors.ink700, fontFamily: fonts.sansBold, fontSize: 16, lineHeight: 20 },
  removeButton: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  removeGlyph: { color: colors.ink400, fontFamily: fonts.sansBold, fontSize: 14 },
  cartEmpty: {
    color: colors.ink500,
    fontFamily: fonts.sans,
    fontSize: 14,
    textAlign: 'center',
    paddingVertical: spacing.lg,
  },

  rule: { height: 1, backgroundColor: colors.brand100, marginVertical: spacing.xs },
  discountRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  discountInput: {
    flex: 1,
    minHeight: 46,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.brand200,
    paddingHorizontal: spacing.md,
    color: colors.ink900,
    fontFamily: fonts.sans,
    fontSize: 15,
  },
  applyButton: { minHeight: 46, paddingHorizontal: spacing.lg },
  toggleRow: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: colors.brand300,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxOn: { backgroundColor: colors.brand600, borderColor: colors.brand600 },
  checkboxMark: { color: colors.white, fontFamily: fonts.sansBold, fontSize: 12 },
  toggleLabel: { flex: 1, color: colors.ink700, fontFamily: fonts.sans, fontSize: 14 },

  totalRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  totalLabel: { color: colors.ink500, fontFamily: fonts.sans, fontSize: 14 },
  totalValue: { color: colors.ink900, fontFamily: fonts.sansMedium, fontSize: 14 },
  continueButton: { marginTop: spacing.sm },

  amountCard: { alignItems: 'center', gap: 4 },
  amountEyebrow: {
    color: colors.ink500,
    fontFamily: fonts.sansBold,
    fontSize: 11,
    letterSpacing: 1.1,
    textTransform: 'uppercase',
  },
  amountValue: { color: colors.ink900, fontFamily: fonts.display, fontSize: 44, lineHeight: 50 },
  amountSub: { color: colors.ink500, fontFamily: fonts.sans, fontSize: 13 },
  amountNote: {
    color: colors.ink500,
    fontFamily: fonts.sans,
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'center',
    marginTop: spacing.xs,
  },

  methodTile: {
    flexGrow: 1,
    flexBasis: '46%',
    minHeight: 72,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.brand100,
    padding: spacing.sm,
  },
  methodTileActive: { borderColor: colors.brand600, backgroundColor: colors.brand50 },
  methodTileDisabled: { opacity: 0.45, backgroundColor: colors.warm },
  methodLabel: { color: colors.ink700, fontFamily: fonts.sansMedium, fontSize: 12, textAlign: 'center' },
  methodLabelActive: { color: colors.ink900, fontFamily: fonts.sansBold },
  methodAvailability: { color: colors.warning, fontFamily: fonts.sansBold, fontSize: 9, letterSpacing: 0.5, textTransform: 'uppercase' },
  tenderNotice: { color: colors.warning, fontFamily: fonts.sansMedium, fontSize: 12, lineHeight: 18 },

  payActions: { flexDirection: 'row', gap: spacing.sm },
  backButton: { paddingHorizontal: spacing.lg },
  chargeButton: { flex: 1 },

  completeCard: { alignItems: 'center', gap: spacing.sm },
  completeMark: {
    width: 60,
    height: 60,
    borderRadius: 30,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.success,
  },
  completeTitle: { color: colors.ink900, fontFamily: fonts.display, fontSize: 26 },
  completeCopy: { color: colors.ink500, fontFamily: fonts.sans, fontSize: 14, textAlign: 'center' },
  completeNote: { color: colors.ink500, fontFamily: fonts.sans, fontSize: 12, lineHeight: 18, textAlign: 'center' },
  completeNotice: { color: colors.success, fontFamily: fonts.sansBold, fontSize: 13, textAlign: 'center' },
  completeActions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm, alignSelf: 'stretch' },
  completeButton: { flex: 1 },

  pressed: { opacity: 0.72, transform: [{ scale: 0.99 }] },
});
