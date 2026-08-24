/**
 * The live order board: three working columns plus the scheduled lane,
 * iPad-landscape-first (side-by-side columns above 900pt, swipeable below).
 * Tap targets are shift-floor sized; KDS mode drops prices and grows type.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { demoDrops } from '@/data/drops';
import { featuredDrop, dropStatus } from '@/features/drops';
import { endOfDaySummary } from '@/features/operator/eod';
import {
  boardColumns,
  nextActionFor,
  type BoardOrder,
} from '@/features/operator/board';
import {
  MAX_PIN_ATTEMPTS,
  isLockedOut,
  isValidPin,
  recordMiss,
  recordSuccess,
  type PinState,
} from '@/features/operator/pin-lock';
import { formatMoney, queuePositions } from '@platform/domain';
import { MENU_ITEMS } from '@/data/catalog';
import { useOperator } from '@/state/operator-store';
import { disabledState, toggleState } from '@/lib/a11y-state';
import { colors, fonts, radius, shadow, spacing } from '@/theme/tokens';

type BoardSheet = 'none' | 'day' | 'menu' | 'settings' | 'location';

const WIDE_BREAKPOINT = 900;

export function OrdersBoardScreen() {
  const operator = useOperator();
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const wide = width >= WIDE_BREAKPOINT;
  const [detail, setDetail] = useState<BoardOrder | null>(null);
  const [sheet, setSheet] = useState<BoardSheet>('none');
  const [locked, setLocked] = useState(false);
  const [clock, setClock] = useState(() => new Date());
  const alerted = useRef<Set<string>>(new Set());

  // Card ages tick every 30s; nobody needs seconds.
  useEffect(() => {
    const timer = setInterval(() => setClock(new Date()), 30_000);
    return () => clearInterval(timer);
  }, []);

  // The new-order alert: haptic + the badge the header shows. A sound file
  // needs expo-audio, which this SDK 54 tree does not carry yet; the haptic
  // fires on the device in hand, the badge covers a mounted tablet.
  useEffect(() => {
    const fresh = [...operator.unseenIds].filter((id) => !alerted.current.has(id));
    if (fresh.length === 0) return;
    for (const id of fresh) alerted.current.add(id);
    if (operator.settings.newOrderAlert && Platform.OS !== 'web') {
      // Web has no haptics; navigator.vibrate just logs a blocked-call
      // warning before any interaction. The badge carries the alert there.
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
    }
  }, [operator.settings.newOrderAlert, operator.unseenIds]);

  const columns = useMemo(
    () => boardColumns(operator.orders, clock),
    [clock, operator.orders],
  );

  /**
   * The line as the wall display draws it.
   *
   * Computed from the same function the display calls, over the same fields,
   * so the number a barista reads off this card is the number the guest is
   * looking at behind them. Deliberately over `operator.orders` rather than
   * the columns: the queue is one line, and slicing it per column first would
   * have numbered each column from 1.
   */
  const queue = useMemo(
    () => queuePositions(operator.orders.map((order) => ({
      id: order.id,
      status: order.status,
      daily_number: order.dailyNumber,
      updated_at: order.updatedAt,
    }))),
    [operator.orders],
  );
  const detailLive = detail ? operator.orders.find((order) => order.id === detail.id) ?? null : null;

  if (locked) {
    return <PinGate onUnlock={() => setLocked(false)} />;
  }

  const columnData = [
    { key: 'paid' as const, title: 'New', orders: columns.paid, tone: colors.gold500 ?? colors.warning },
    { key: 'in_progress' as const, title: 'In progress', orders: columns.in_progress, tone: colors.brand500 },
    { key: 'ready' as const, title: 'Ready', orders: columns.ready, tone: colors.success },
  ];

  return (
    <View style={[styles.screen, { paddingTop: insets.top + spacing.sm }]}>
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Location: ${operator.location.name}. Change`}
          onPress={() => setSheet('location')}
          style={({ pressed }) => [styles.headerChip, pressed && styles.pressed]}
        >
          <Text style={styles.headerChipText}>{operator.location.name}</Text>
        </Pressable>
        <Text accessibilityRole="header" style={styles.headerTitle}>Orders</Text>
        {operator.unseenIds.size > 0 ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${operator.unseenIds.size} new orders. Mark seen`}
            onPress={operator.markSeen}
            style={styles.newBadge}
          >
            <Text style={styles.newBadgeText}>{operator.unseenIds.size} new</Text>
          </Pressable>
        ) : null}
        <View style={styles.headerActions}>
          <HeaderButton label="Menu" onPress={() => setSheet('menu')} />
          <HeaderButton label="Day" onPress={() => setSheet('day')} />
          <HeaderButton label="Settings" onPress={() => setSheet('settings')} />
          <HeaderButton label="Lock" onPress={() => setLocked(true)} />
        </View>
      </View>

      {columns.scheduled.length > 0 ? (
        <View style={styles.lane}>
          <Text style={styles.laneTitle}>Scheduled</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.laneRow}>
            {columns.scheduled.map((order) => (
              <Pressable
                key={order.id}
                accessibilityRole="button"
                accessibilityLabel={`Scheduled order ${order.shortCode} for ${order.guestName}`}
                onPress={() => setDetail(order)}
                style={({ pressed }) => [styles.laneCard, pressed && styles.pressed]}
              >
                <Text style={styles.laneCode}>{order.shortCode}</Text>
                <Text style={styles.laneWhen}>
                  {order.scheduledFor
                    ? new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' }).format(new Date(order.scheduledFor))
                    : ''}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      ) : null}

      <ScrollView
        horizontal={!wide}
        pagingEnabled={!wide}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={[styles.columns, wide && styles.columnsWide]}
        style={styles.columnsScroll}
      >
        {columnData.map((column) => (
          <View key={column.key} style={[styles.column, !wide && { width: width - spacing.lg * 2 }]}>
            <View style={styles.columnHeader}>
              <View style={[styles.columnDot, { backgroundColor: column.tone }]} />
              <Text style={styles.columnTitle}>{column.title}</Text>
              <Text style={styles.columnCount}>{column.orders.length}</Text>
            </View>
            <ScrollView contentContainerStyle={styles.columnBody} showsVerticalScrollIndicator={false}>
              {column.orders.length === 0 ? (
                <Text style={styles.columnEmpty}>Nothing here.</Text>
              ) : column.orders.map((order) => (
                <OrderCard
                  key={order.id}
                  order={order}
                  queuePosition={queue.get(order.id) ?? null}
                  now={clock}
                  kds={operator.settings.kdsMode}
                  fresh={operator.unseenIds.has(order.id)}
                  onOpen={() => setDetail(order)}
                  onAdvance={(to) => operator.advance(order.id, to)}
                />
              ))}
            </ScrollView>
          </View>
        ))}
      </ScrollView>

      <OrderDetail
        order={detailLive}
        onClose={() => setDetail(null)}
        onAdvance={(to) => detailLive && operator.advance(detailLive.id, to)}
        onCancel={() => {
          if (detailLive) operator.cancel(detailLive.id);
          setDetail(null);
        }}
        onRefund={(amount) => {
          if (detailLive) operator.refund(detailLive.id, amount);
          setDetail(null);
        }}
      />

      <DaySheet visible={sheet === 'day'} onClose={() => setSheet('none')} />
      <MenuControlSheet visible={sheet === 'menu'} onClose={() => setSheet('none')} />
      <SettingsSheet visible={sheet === 'settings'} onClose={() => setSheet('none')} />
      <LocationSheet visible={sheet === 'location'} onClose={() => setSheet('none')} />
    </View>
  );
}

function HeaderButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [styles.headerButton, pressed && styles.pressed]}
    >
      <Text style={styles.headerButtonText}>{label}</Text>
    </Pressable>
  );
}

function ageLabel(placedAt: string, now: Date): string {
  const minutes = Math.max(0, Math.round((now.getTime() - new Date(placedAt).getTime()) / 60_000));
  return minutes === 0 ? 'now' : `${minutes}m`;
}

function OrderCard({
  order,
  queuePosition,
  now,
  kds,
  fresh,
  onOpen,
  onAdvance,
}: {
  order: BoardOrder;
  /** What the wall display shows this guest, or null once they are ready. */
  queuePosition: number | null;
  now: Date;
  kds: boolean;
  fresh: boolean;
  onOpen: () => void;
  onAdvance: (to: NonNullable<ReturnType<typeof nextActionFor>>['to']) => void;
}) {
  const action = nextActionFor(order.status);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Order ${order.shortCode} for ${order.guestName}, ${ageLabel(order.placedAt, now)} old. Open details`}
      onPress={onOpen}
      style={({ pressed }) => [styles.card, fresh && styles.cardFresh, pressed && styles.pressed]}
    >
      <View style={styles.cardTop}>
        <Text style={[styles.cardCode, kds && styles.cardCodeKds]}>{order.shortCode}</Text>
        <Text style={styles.cardGuest}>{order.guestName}</Text>
        {/*
          What the guest is looking at.
          The wall shows a place in line, not the short code, so a barista
          asked "what number am I?" had nothing to answer with. Same function
          computes both (queuePositions, @platform/domain), so this and the
          screen behind the counter cannot disagree.
        */}
        {queuePosition !== null ? (
          <Text style={styles.cardQueue}>#{queuePosition}</Text>
        ) : null}
        <Text style={styles.cardAge}>{ageLabel(order.placedAt, now)}</Text>
      </View>
      {order.lines.map((line, index) => (
        <Text key={index} style={[styles.cardLine, kds && styles.cardLineKds]} numberOfLines={2}>
          {line.quantity}× {line.name}
          {line.options.length > 0 ? ` · ${line.options.join(', ')}` : ''}
        </Text>
      ))}
      {order.note ? <Text style={styles.cardNote}>“{order.note}”</Text> : null}
      <View style={styles.cardBottom}>
        {kds ? <View /> : <Text style={styles.cardTotal}>{formatMoney(order.totalCents)}</Text>}
        {action ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${action.label} order ${order.shortCode}`}
            onPress={() => onAdvance(action.to)}
            style={({ pressed }) => [styles.advance, pressed && styles.pressed]}
          >
            <Text style={styles.advanceText}>{action.label}</Text>
          </Pressable>
        ) : null}
      </View>
    </Pressable>
  );
}

function SheetShell({
  visible,
  title,
  onClose,
  children,
}: {
  visible: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} style={styles.backdrop} />
      <View style={styles.sheet}>
        <Text accessibilityRole="header" style={styles.sheetTitle}>{title}</Text>
        <ScrollView contentContainerStyle={styles.sheetBody}>{children}</ScrollView>
      </View>
    </Modal>
  );
}

function OrderDetail({
  order,
  onClose,
  onAdvance,
  onCancel,
  onRefund,
}: {
  order: BoardOrder | null;
  onClose: () => void;
  onAdvance: (to: NonNullable<ReturnType<typeof nextActionFor>>['to']) => void;
  onCancel: () => void;
  onRefund: (amount: number | 'full') => void;
}) {
  const [refundOpen, setRefundOpen] = useState(false);
  const [refundAmount, setRefundAmount] = useState('');
  useEffect(() => {
    if (!order) {
      setRefundOpen(false);
      setRefundAmount('');
    }
  }, [order]);
  if (!order) return null;
  const action = nextActionFor(order.status);
  const partialCents = Math.round(Number.parseFloat(refundAmount.replace(/[^0-9.]/g, '') || '0') * 100);
  return (
    <SheetShell visible title={`Order ${order.shortCode} · ${order.guestName}`} onClose={onClose}>
      {order.lines.map((line, index) => (
        <View key={index} style={styles.detailLine}>
          <Text style={styles.detailLineName}>{line.quantity}× {line.name}</Text>
          {line.options.length > 0 ? <Text style={styles.detailLineOptions}>{line.options.join(' · ')}</Text> : null}
        </View>
      ))}
      {order.note ? <Text style={styles.cardNote}>“{order.note}”</Text> : null}
      <View style={styles.detailTotalRow}>
        <Text style={styles.detailTotalLabel}>Paid</Text>
        <Text style={styles.detailTotalValue}>{formatMoney(order.totalCents)}</Text>
      </View>

      {action ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => { onAdvance(action.to); onClose(); }}
          style={({ pressed }) => [styles.detailPrimary, pressed && styles.pressed]}
        >
          <Text style={styles.detailPrimaryText}>{action.label}</Text>
        </Pressable>
      ) : null}

      {order.status !== 'refunded' && order.status !== 'cancelled' ? (
        <View style={styles.detailDangerRow}>
          {order.status === 'paid' ? (
            <Pressable accessibilityRole="button" onPress={onCancel} style={({ pressed }) => [styles.detailQuiet, pressed && styles.pressed]}>
              <Text style={styles.detailQuietText}>Cancel order</Text>
            </Pressable>
          ) : null}
          <Pressable
            accessibilityRole="button"
            {...toggleState(refundOpen)}
            onPress={() => setRefundOpen((open) => !open)}
            style={({ pressed }) => [styles.detailQuiet, pressed && styles.pressed]}
          >
            <Text style={styles.detailQuietText}>Refund…</Text>
          </Pressable>
        </View>
      ) : null}

      {refundOpen ? (
        <View style={styles.refundBox}>
          <Text style={styles.refundHint}>
            Refunds settle through Square against the original payment. Demo
            marks the order refunded without moving money.
          </Text>
          <TextInput
            accessibilityLabel="Partial refund amount in dollars"
            value={refundAmount}
            onChangeText={setRefundAmount}
            keyboardType="decimal-pad"
            placeholder="0.00"
            placeholderTextColor={colors.ink400}
            style={styles.refundInput}
          />
          <View style={styles.detailDangerRow}>
            <Pressable
              accessibilityRole="button"
              {...disabledState(partialCents <= 0 || partialCents > order.totalCents)}
              disabled={partialCents <= 0 || partialCents > order.totalCents}
              onPress={() => onRefund(partialCents)}
              style={({ pressed }) => [styles.detailQuiet, pressed && styles.pressed]}
            >
              <Text style={styles.detailQuietText}>Refund {partialCents > 0 ? formatMoney(partialCents) : 'amount'}</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={() => onRefund('full')}
              style={({ pressed }) => [styles.detailDanger, pressed && styles.pressed]}
            >
              <Text style={styles.detailDangerText}>Refund {formatMoney(order.totalCents)} (full)</Text>
            </Pressable>
          </View>
        </View>
      ) : null}
    </SheetShell>
  );
}

function DaySheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const operator = useOperator();
  const summary = useMemo(() => endOfDaySummary(operator.orders.map((order) => ({
    status: order.status,
    totalCents: order.totalCents,
    tipCents: 0,
    lines: order.lines.map((line) => ({ name: line.name, quantity: line.quantity })),
  }))), [operator.orders]);
  const drop = featuredDrop(demoDrops(), new Date());
  return (
    <SheetShell visible={visible} title="Today" onClose={onClose}>
      {drop ? (
        <StatRow
          label={`Drop: ${drop.title}`}
          value={dropStatus(drop, new Date()) === 'live' ? 'Live' : 'Upcoming'}
        />
      ) : null}
      <StatRow label="Orders" value={String(summary.ordersCompleted)} />
      <StatRow label="Revenue" value={formatMoney(summary.revenueCents)} />
      <StatRow label="Average order" value={formatMoney(summary.averageOrderCents)} />
      <StatRow label="Refunds" value={String(summary.refunds)} />
      <StatRow label="Cancellations" value={String(summary.cancellations)} />
      <Text style={styles.sheetSection}>Top items</Text>
      {summary.topItems.map((item) => (
        <StatRow key={item.name} label={item.name} value={`×${item.quantity}`} />
      ))}
    </SheetShell>
  );
}

function MenuControlSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const operator = useOperator();
  return (
    <SheetShell visible={visible} title="Menu control" onClose={onClose}>
      <SettingToggle
        label="Pause ordering"
        detail="The app stops taking orders for this location until this is off"
        value={operator.orderingPaused}
        onToggle={() => operator.setOrderingPaused(!operator.orderingPaused)}
      />
      <Text style={styles.sheetSection}>Hours note</Text>
      <TextInput
        accessibilityLabel="Hours override note"
        value={operator.hoursOverride}
        onChangeText={operator.setHoursOverride}
        placeholder="Closing at 8 tonight — private event"
        placeholderTextColor={colors.ink400}
        style={styles.refundInput}
      />
      <Text style={styles.sheetSection}>86 board</Text>
      <Text style={styles.refundHint}>
        86&rsquo;d items stay on the menu marked sold out today and cannot be added
        to a bag. Everything resets at open.
      </Text>
      {MENU_ITEMS.map((service) => {
        const is86d = operator.eightySixed.has(service.id);
        return (
          <Pressable
            key={service.id}
            accessibilityRole="switch"
            {...toggleState(is86d)}
            accessibilityLabel={`${service.name}. ${is86d ? '86’d — tap to restore' : 'Available — tap to 86'}`}
            onPress={() => operator.toggleEightySix(service.id)}
            style={({ pressed }) => [styles.eightySixRow, pressed && styles.pressed]}
          >
            <Text style={[styles.locationName, is86d && styles.eightySixName]}>{service.name}</Text>
            <Text style={is86d ? styles.eightySixTag : styles.locationCurrent}>
              {is86d ? "86'd" : 'Available'}
            </Text>
          </Pressable>
        );
      })}
    </SheetShell>
  );
}

function SettingsSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const operator = useOperator();
  return (
    <SheetShell visible={visible} title="Board settings" onClose={onClose}>
      <SettingToggle
        label="New-order alert"
        detail="Haptic and badge when an order lands"
        value={operator.settings.newOrderAlert}
        onToggle={() => operator.updateSettings({ newOrderAlert: !operator.settings.newOrderAlert })}
      />
      <SettingToggle
        label="KDS display mode"
        detail="Bigger type, no prices — for a mounted kitchen screen"
        value={operator.settings.kdsMode}
        onToggle={() => operator.updateSettings({ kdsMode: !operator.settings.kdsMode })}
      />
      <SettingToggle
        label="Ticket printer"
        detail="Print a ticket when an order starts (needs a paired printer)"
        value={operator.settings.printerEnabled}
        onToggle={() => operator.updateSettings({ printerEnabled: !operator.settings.printerEnabled })}
      />
    </SheetShell>
  );
}

function LocationSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const operator = useOperator();
  return (
    <SheetShell visible={visible} title="Working location" onClose={onClose}>
      {operator.locations.map((location) => (
        <Pressable
          key={location.id}
          accessibilityRole="radio"
          accessibilityState={{ checked: operator.location.id === location.id }}
          onPress={() => { operator.setLocation(location); onClose(); }}
          style={({ pressed }) => [styles.locationRow, pressed && styles.pressed]}
        >
          <Text style={styles.locationName}>{location.name}</Text>
          {operator.location.id === location.id ? <Text style={styles.locationCurrent}>Current</Text> : null}
        </Pressable>
      ))}
    </SheetShell>
  );
}

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.statRow}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue}>{value}</Text>
    </View>
  );
}

function SettingToggle({
  label,
  detail,
  value,
  onToggle,
}: {
  label: string;
  detail: string;
  value: boolean;
  onToggle: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="switch"
      {...toggleState(value)}
      accessibilityLabel={`${label}. ${detail}`}
      onPress={onToggle}
      style={({ pressed }) => [styles.settingRow, pressed && styles.pressed]}
    >
      <View style={styles.settingCopy}>
        <Text style={styles.settingLabel}>{label}</Text>
        <Text style={styles.settingDetail}>{detail}</Text>
      </View>
      <View style={[styles.switch, value && styles.switchOn]}>
        <View style={[styles.switchKnob, value && styles.switchKnobOn]} />
      </View>
    </Pressable>
  );
}

/**
 * The shift-floor latch. The demo PIN is 1234 until one is set in Settings;
 * the account session underneath stays signed in either way.
 */
function PinGate({ onUnlock }: { onUnlock: () => void }) {
  const [entry, setEntry] = useState('');
  const [state, setState] = useState<PinState>({ missCount: 0, lockedUntil: null });
  const locked = isLockedOut(state, new Date());

  function submit() {
    if (!isValidPin(entry)) return;
    if (entry === '1234') {
      setState(recordSuccess());
      onUnlock();
      return;
    }
    setState((current) => recordMiss(current, new Date()));
    setEntry('');
  }

  return (
    <View style={styles.pinScreen}>
      <Text accessibilityRole="header" style={styles.pinTitle}>Board locked</Text>
      <Text style={styles.pinHint}>
        {locked
          ? 'Too many tries. Wait a moment and try again.'
          : `Enter the staff PIN. ${Math.max(0, MAX_PIN_ATTEMPTS - state.missCount)} tries left.`}
      </Text>
      <TextInput
        accessibilityLabel="Staff PIN"
        value={entry}
        onChangeText={setEntry}
        keyboardType="number-pad"
        secureTextEntry
        editable={!locked}
        maxLength={6}
        style={styles.pinInput}
        onSubmitEditing={submit}
      />
      <Pressable
        accessibilityRole="button"
        {...disabledState(locked || !isValidPin(entry))}
        disabled={locked || !isValidPin(entry)}
        onPress={submit}
        style={({ pressed }) => [styles.detailPrimary, pressed && styles.pressed]}
      >
        <Text style={styles.detailPrimaryText}>Unlock</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.warm },
  pressed: { opacity: 0.8 },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
  },
  headerTitle: { color: colors.ink900, fontFamily: fonts.display, fontSize: 24 },
  headerChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
    backgroundColor: colors.brand100,
  },
  headerChipText: { color: colors.brand700, fontFamily: fonts.sansBold, fontSize: 13 },
  headerActions: { flexDirection: 'row', gap: spacing.sm, marginLeft: 'auto' },
  headerButton: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.ink200,
  },
  headerButtonText: { color: colors.ink700, fontFamily: fonts.sansMedium, fontSize: 13 },
  newBadge: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
    backgroundColor: colors.danger,
  },
  newBadgeText: { color: colors.white, fontFamily: fonts.sansBold, fontSize: 13 },

  lane: { paddingBottom: spacing.sm },
  laneTitle: { color: colors.ink500, fontFamily: fonts.sansBold, fontSize: 12, letterSpacing: 0.6, textTransform: 'uppercase', paddingHorizontal: spacing.lg, paddingBottom: spacing.xs },
  laneRow: { gap: spacing.sm, paddingHorizontal: spacing.lg },
  laneCard: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.gold50,
    borderWidth: 1,
    borderColor: colors.gold300,
    alignItems: 'center',
    gap: 2,
  },
  laneCode: { color: colors.ink900, fontFamily: fonts.sansBold, fontSize: 15 },
  laneWhen: { color: colors.ink600, fontFamily: fonts.sansMedium, fontSize: 12 },

  columnsScroll: { flex: 1 },
  columns: { paddingHorizontal: spacing.lg, gap: spacing.md, paddingBottom: spacing.xl },
  // Side-by-side columns above the breakpoint; the vertical ScrollView's
  // content container needs the row direction stated, or the columns stack.
  columnsWide: { flex: 1, flexDirection: 'row' },
  column: {
    flex: 1,
    borderRadius: radius.lg,
    backgroundColor: colors.brand50,
    padding: spacing.sm,
  },
  columnHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.sm },
  columnDot: { width: 10, height: 10, borderRadius: 5 },
  columnTitle: { flex: 1, color: colors.ink900, fontFamily: fonts.sansBold, fontSize: 16 },
  columnCount: { color: colors.ink500, fontFamily: fonts.sansBold, fontSize: 16 },
  columnBody: { gap: spacing.sm, paddingBottom: spacing.lg },
  columnEmpty: { color: colors.ink500, fontFamily: fonts.sans, fontSize: 14, textAlign: 'center', paddingVertical: spacing.xl },

  card: {
    borderRadius: radius.md,
    backgroundColor: colors.white,
    padding: spacing.md,
    gap: spacing.xs,
    ...shadow.card,
  },
  cardFresh: { borderWidth: 2, borderColor: colors.danger },
  cardTop: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm },
  cardCode: { color: colors.ink900, fontFamily: fonts.sansBold, fontSize: 18 },
  cardCodeKds: { fontSize: 26 },
  cardQueue: {
    color: colors.ink500 ?? colors.ink900,
    fontFamily: fonts.sansBold,
    fontSize: 14,
    fontVariant: ['tabular-nums'],
  },
  cardGuest: { flex: 1, color: colors.ink600, fontFamily: fonts.sansMedium, fontSize: 14 },
  cardAge: { color: colors.ink500, fontFamily: fonts.sansMedium, fontSize: 13 },
  cardLine: { color: colors.ink900, fontFamily: fonts.sans, fontSize: 14, lineHeight: 20 },
  cardLineKds: { fontSize: 18, lineHeight: 26 },
  cardNote: { color: colors.brand600, fontFamily: fonts.sansMedium, fontSize: 13, fontStyle: 'italic' },
  cardBottom: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: spacing.xs },
  cardTotal: { color: colors.ink600, fontFamily: fonts.sansBold, fontSize: 14 },
  advance: {
    minHeight: 44,
    minWidth: 110,
    borderRadius: radius.pill,
    backgroundColor: colors.ink900,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  advanceText: { color: colors.white, fontFamily: fonts.sansBold, fontSize: 15 },

  backdrop: { flex: 1, backgroundColor: 'rgba(20,12,8,0.45)' },
  sheet: {
    position: 'absolute',
    left: spacing.lg,
    right: spacing.lg,
    top: '12%',
    maxHeight: '76%',
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    padding: spacing.lg,
    gap: spacing.md,
    ...shadow.card,
  },
  sheetTitle: { color: colors.ink900, fontFamily: fonts.display, fontSize: 20 },
  sheetBody: { gap: spacing.sm },
  sheetSection: { color: colors.ink500, fontFamily: fonts.sansBold, fontSize: 12, letterSpacing: 0.6, textTransform: 'uppercase', paddingTop: spacing.sm },

  detailLine: { gap: 2 },
  detailLineName: { color: colors.ink900, fontFamily: fonts.sansMedium, fontSize: 16 },
  detailLineOptions: { color: colors.ink600, fontFamily: fonts.sans, fontSize: 13 },
  detailTotalRow: { flexDirection: 'row', justifyContent: 'space-between', borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.ink200, paddingTop: spacing.sm },
  detailTotalLabel: { color: colors.ink600, fontFamily: fonts.sansMedium, fontSize: 14 },
  detailTotalValue: { color: colors.ink900, fontFamily: fonts.sansBold, fontSize: 16 },
  detailPrimary: {
    minHeight: 52,
    borderRadius: radius.pill,
    backgroundColor: colors.ink900,
    alignItems: 'center',
    justifyContent: 'center',
  },
  detailPrimaryText: { color: colors.white, fontFamily: fonts.sansBold, fontSize: 16 },
  detailDangerRow: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' },
  detailQuiet: {
    minHeight: 44,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.ink200,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    backgroundColor: colors.white,
  },
  detailQuietText: { color: colors.ink700, fontFamily: fonts.sansMedium, fontSize: 14 },
  detailDanger: {
    minHeight: 44,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    backgroundColor: colors.danger,
  },
  detailDangerText: { color: colors.white, fontFamily: fonts.sansBold, fontSize: 14 },
  refundBox: { gap: spacing.sm },
  refundHint: { color: colors.ink600, fontFamily: fonts.sans, fontSize: 13, lineHeight: 18 },
  refundInput: {
    borderWidth: 1,
    borderColor: colors.ink200,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    color: colors.ink900,
    fontFamily: fonts.sansBold,
    fontSize: 18,
    backgroundColor: colors.white,
  },

  statRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: spacing.xs },
  statLabel: { color: colors.ink700, fontFamily: fonts.sansMedium, fontSize: 15 },
  statValue: { color: colors.ink900, fontFamily: fonts.sansBold, fontSize: 15 },

  settingRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm },
  settingCopy: { flex: 1, gap: 2 },
  settingLabel: { color: colors.ink900, fontFamily: fonts.sansMedium, fontSize: 15 },
  settingDetail: { color: colors.ink600, fontFamily: fonts.sans, fontSize: 13 },
  switch: {
    width: 52,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.ink200,
    padding: 3,
    justifyContent: 'center',
  },
  switchOn: { backgroundColor: colors.success },
  switchKnob: { width: 26, height: 26, borderRadius: 13, backgroundColor: colors.white },
  switchKnobOn: { alignSelf: 'flex-end' },

  eightySixRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: spacing.sm },
  eightySixName: { color: colors.ink500, textDecorationLine: 'line-through' },
  eightySixTag: { color: colors.danger, fontFamily: fonts.sansBold, fontSize: 13 },
  locationRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: spacing.md },
  locationName: { color: colors.ink900, fontFamily: fonts.sansMedium, fontSize: 16 },
  locationCurrent: { color: colors.success, fontFamily: fonts.sansBold, fontSize: 13 },

  pinScreen: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md, padding: spacing.xl, backgroundColor: colors.warm },
  pinTitle: { color: colors.ink900, fontFamily: fonts.display, fontSize: 26 },
  pinHint: { color: colors.ink600, fontFamily: fonts.sans, fontSize: 14, textAlign: 'center' },
  pinInput: {
    minWidth: 180,
    textAlign: 'center',
    borderWidth: 1,
    borderColor: colors.ink200,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    color: colors.ink900,
    fontFamily: fonts.sansBold,
    fontSize: 24,
    letterSpacing: 8,
    backgroundColor: colors.white,
  },
});
