/**
 * The bag, and the optional note that rides with the order.
 *
 * Both are pushed pages that cover the tab bar, so their last row clears the
 * sticky bar through `useStickyBarClearance` rather than `Screen`'s tab-bar
 * padding.
 */
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { CollapsingScreen } from '@/components/collapsing-screen';
import { AppIcon } from '@/components/icon';
import { MenuImage } from '@/components/menu-image';
import { QuantityStepper } from '@/components/order/option-controls';
import {
  ActionButton,
  RewardsBanner,
  StickyActionBar,
  useStickyBarClearance,
} from '@/components/order/order-chrome';
import { Body } from '@/components/ui';
import { fulfillmentDetail, fulfillmentLabel, type OrderFulfillment ,
  MAX_LINE_QUANTITY,
  MAX_ORDER_NOTE_LENGTH,
  orderLineTotalCents,
  type OrderCart,
  type OrderLine,
} from '@platform/domain';
import { formatMoney } from '@platform/domain';
import { describePickupWindow } from '@/features/order/pickup';
import { POINTS_LABEL } from '@/features/rewards/presentation';
import { useCustomerCatalog } from '@/state/catalog-context';
import { menuImageFrame } from '@platform/ui';

import { findMenuItem } from './menu-data';
import { useTokens as useBrandTokens, type BrandTokens } from '@platform/ui';

export function BagStep({
  cart,
  fulfillment,
  windowValue,
  subtotalCents,
  pointsPerDollar,
  onBack,
  onEdit,
  onChangeQuantity,
  onCheckout,
}: {
  cart: OrderCart;
  fulfillment: OrderFulfillment;
  windowValue: string | null;
  subtotalCents: number;
  pointsPerDollar: number;
  onBack: () => void;
  onEdit: () => void;
  onChangeQuantity: (lineId: string, delta: number) => void;
  onCheckout: () => void;
}) {
  const tokens = useBrandTokens();
  const styles = createStyles(tokens);
  const clearance = useStickyBarClearance();
  const window = windowValue ? describePickupWindow(windowValue, new Date()) : null;
  const empty = cart.lines.length === 0;

  return (
    <>
      <CollapsingScreen
        title="My Bag"
        onBack={onBack}
        backLabel="Menu"
        style={styles.page}
        headerBackgroundColor={tokens.surface}
        headerBorderColor={tokens.surface}
        contentContainerStyle={[styles.content, { paddingBottom: clearance }]}
      >
        <View style={styles.contextCard}>
          <ContextRow
            icon="clock"
            label={window ? `${window.dayLabel} · ${window.timeLabel}` : 'No time chosen'}
          />
          <View style={styles.contextDivider} />
          <ContextRow
            icon="mappin"
            label={fulfillmentLabel(fulfillment)}
            detail={fulfillmentDetail(fulfillment)}
            onEdit={onEdit}
          />
        </View>

        {empty ? (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>Your bag is empty.</Text>
            <Body muted>Head back to the menu and add something warm.</Body>
          </View>
        ) : (
          <>
            {cart.lines.map((line) => (
              <BagLine
                key={line.id}
                line={line}
                onChangeQuantity={(delta) => onChangeQuantity(line.id, delta)}
              />
            ))}

            <View style={styles.subtotalRow}>
              <Text style={styles.subtotalLabel}>Subtotal</Text>
              <Text style={styles.subtotalValue}>{formatMoney(subtotalCents)}</Text>
            </View>

            <RewardsBanner
              label={`Earn ${pointsPerDollar} ${POINTS_LABEL} per $1 on this order`}
            />

            {cart.note ? (
              <View style={styles.noteEcho}>
                <AppIcon name="pencil" size={16} tintColor={tokens.primary} />
                <Text style={styles.noteEchoText}>{cart.note}</Text>
              </View>
            ) : null}
          </>
        )}
      </CollapsingScreen>
      <StickyActionBar>
        <ActionButton
          label="Checkout"
          value={empty ? undefined : formatMoney(subtotalCents)}
          disabled={empty}
          onPress={onCheckout}
        />
      </StickyActionBar>
    </>
  );
}

function ContextRow({
  icon,
  label,
  detail,
  onEdit,
}: {
  icon: 'clock' | 'mappin';
  label: string;
  detail?: string;
  onEdit?: () => void;
}) {
  const tokens = useBrandTokens();
  const styles = createStyles(tokens);
  return (
    <View style={styles.contextRow}>
      <AppIcon name={icon} size={16} tintColor={tokens.primary} />
      <View style={styles.contextCopy}>
        <Text style={styles.contextLabel}>{label}</Text>
        {detail ? <Text numberOfLines={1} style={styles.contextDetail}>{detail}</Text> : null}
      </View>
      {onEdit ? (
        // A Pressable, not a Text with onPress: react-native-web gives the
        // press responder keyboard activation, which a Text does not get, and
        // the label on its own was a 38x17pt target.
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Change when and where this order is going"
          hitSlop={8}
          onPress={onEdit}
          style={({ pressed }) => [styles.contextEditButton, pressed && styles.pressed]}
        >
          <Text style={styles.contextEdit}>Edit</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function BagLine({
  line,
  onChangeQuantity,
}: {
  line: OrderLine;
  onChangeQuantity: (delta: number) => void;
}) {
  const tokens = useBrandTokens();
  const styles = createStyles(tokens);
  const { items } = useCustomerCatalog();
  const item = findMenuItem(items, line.itemId);
  return (
    <View style={styles.line}>
      <View style={styles.lineTop}>
        {item ? (
          <MenuImage source={item.image} variant="line" alt="" />
        ) : (
          <View style={styles.lineImage} />
        )}
        <View style={styles.lineCopy}>
          <Text style={styles.lineName}>{line.name}</Text>
          <Text style={styles.lineSummary}>{line.optionSummary}</Text>
        </View>
        <Text style={styles.lineUnit}>{formatMoney(line.unitPriceCents)}</Text>
      </View>
      <View style={styles.lineBottom}>
        <QuantityStepper
          quantity={line.quantity}
          max={MAX_LINE_QUANTITY}
          itemLabel={line.name}
          onDecrease={() => onChangeQuantity(-1)}
          onIncrease={() => onChangeQuantity(1)}
        />
        <Text style={styles.lineTotal}>{formatMoney(orderLineTotalCents(line))}</Text>
      </View>
    </View>
  );
}

export function NoteStep({
  note,
  onBack,
  onChangeNote,
  onDone,
}: {
  note: string;
  onBack: () => void;
  onChangeNote: (note: string) => void;
  onDone: () => void;
}) {
  const tokens = useBrandTokens();
  const styles = createStyles(tokens);
  const clearance = useStickyBarClearance();
  const remaining = MAX_ORDER_NOTE_LENGTH - note.length;
  return (
    <>
      <CollapsingScreen
        title="Add a Note"
        onBack={onBack}
        backLabel="Bag"
        keyboardShouldPersistTaps="handled"
        style={styles.page}
        headerBackgroundColor={tokens.surface}
        headerBorderColor={tokens.surface}
        contentContainerStyle={[styles.content, { paddingBottom: clearance }]}
      >
        <Body muted>
          Ordering for someone special, or something the bar should know? Add a note and it goes on
          the cup.
        </Body>
        <View style={styles.noteField}>
          <View style={styles.noteHeader}>
            <Text style={styles.fieldLabel}>Note</Text>
            <Text style={styles.noteCount}>{remaining}</Text>
          </View>
          <TextInput
            accessibilityLabel="Order note"
            value={note}
            onChangeText={onChangeNote}
            placeholder="Optional"
            placeholderTextColor={tokens.textMuted}
            maxLength={MAX_ORDER_NOTE_LENGTH}
            multiline
            style={styles.noteInput}
          />
        </View>
      </CollapsingScreen>
      <StickyActionBar>
        <ActionButton label={note.trim() ? 'Save note' : 'Skip'} onPress={onDone} />
      </StickyActionBar>
    </>
  );
}

const LINE_FRAME = menuImageFrame('line');

const createStyles = (tokens: BrandTokens) => StyleSheet.create({
  page: { backgroundColor: tokens.surface },
  content: { gap: tokens.spacing.lg },

  contextCard: { borderRadius: tokens.radius.lg, backgroundColor: tokens.surfaceElevated, paddingHorizontal: tokens.spacing.lg },
  contextRow: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: tokens.spacing.md },
  contextDivider: { height: StyleSheet.hairlineWidth, backgroundColor: tokens.secondary },
  contextCopy: { flex: 1 },
  contextLabel: { color: tokens.textPrimary, fontFamily: tokens.fontBody, fontSize: 14 },
  contextDetail: { color: tokens.textMuted, fontFamily: tokens.fontBody, fontSize: 12 },
  contextEditButton: { minHeight: 44, minWidth: 44, alignItems: 'center', justifyContent: 'center' },
  contextEdit: { color: tokens.primary, fontFamily: tokens.fontBody, fontSize: 14 },
  pressed: { opacity: 0.72 },

  empty: { gap: tokens.spacing.sm, paddingVertical: tokens.spacing.xxl },
  emptyTitle: { color: tokens.textPrimary, fontFamily: tokens.fontBody, fontSize: 20 },

  line: { borderRadius: tokens.radius.lg, backgroundColor: tokens.surfaceElevated, padding: tokens.spacing.lg, gap: tokens.spacing.md },
  lineTop: { flexDirection: 'row', alignItems: 'flex-start', gap: tokens.spacing.lg },
  // Empty state for a line whose item has no photograph. Sized from the same
  // frame MenuImage uses, so the two cannot drift apart.
  lineImage: { width: LINE_FRAME.size, height: LINE_FRAME.size, borderRadius: tokens.radius.md, backgroundColor: tokens.surface },
  lineCopy: { flex: 1, gap: 3 },
  lineName: { color: tokens.textPrimary, fontFamily: tokens.fontBody, fontSize: 16 },
  lineSummary: { color: tokens.textMuted, fontFamily: tokens.fontBody, fontSize: 12, lineHeight: 17 },
  lineUnit: { color: tokens.textMuted, fontFamily: tokens.fontBody, fontSize: 14 },
  lineBottom: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  lineTotal: { color: tokens.textPrimary, fontFamily: tokens.fontBody, fontSize: 16 },

  subtotalRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: tokens.spacing.sm },
  subtotalLabel: { color: tokens.textPrimary, fontFamily: tokens.fontBody, fontSize: 20 },
  subtotalValue: { color: tokens.textPrimary, fontFamily: tokens.fontBody, fontSize: 20 },

  noteEcho: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: tokens.spacing.md,
    padding: tokens.spacing.lg,
    borderRadius: tokens.radius.lg,
    backgroundColor: tokens.surface,
  },
  noteEchoText: { flex: 1, color: tokens.textPrimary, fontFamily: tokens.fontBody, fontSize: 13, lineHeight: 18 },

  noteField: { gap: tokens.spacing.sm },
  noteHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  fieldLabel: { color: tokens.textPrimary, fontFamily: tokens.fontBody, fontSize: 13 },
  noteCount: { color: tokens.textMuted, fontFamily: tokens.fontBody, fontSize: 12 },
  noteInput: {
    minHeight: 108,
    borderRadius: tokens.radius.lg,
    borderWidth: 1,
    borderColor: tokens.secondary,
    backgroundColor: tokens.surfaceElevated,
    color: tokens.textPrimary,
    fontFamily: tokens.fontBody,
    fontSize: 16,
    padding: tokens.spacing.lg,
    textAlignVertical: 'top',
  },
});
