/**
 * The live order board: three working columns plus the scheduled lane,
 * iPad-first: two lanes stay visible in portrait and all three fit in
 * landscape; phones page through one lane at a time.
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
  canCancelWithoutRefund,
  isPaymentDue,
  nextActionFor,
  packContentsLabel,
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
import { operatorLayout } from '@/lib/responsive-layout';
import { formatMoney, queuePositions } from '@platform/domain';
import { useOperator } from '@/state/operator-store';
import { alpha, disabledState, toggleState } from '@platform/ui';
import { useTokens as useBrandTokens, type BrandTokens } from '@platform/ui';

type BoardSheet = 'none' | 'day' | 'menu' | 'settings' | 'location';

export function OrdersBoardScreen() {
  const tokens = useBrandTokens();
  const styles = createStyles(tokens);
  const operator = useOperator();
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const layout = operatorLayout(width, height);
  const allColumnsVisible = layout.boardColumnsVisible === 3;
  const visibleColumnWidth = Math.max(
    240,
    (width - tokens.spacing.xl * 2 - tokens.spacing.lg * (layout.boardColumnsVisible - 1))
      / layout.boardColumnsVisible,
  );
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
    { key: 'paid' as const, title: 'New', orders: columns.paid, tone: tokens.accent ?? tokens.warning },
    { key: 'in_progress' as const, title: 'In progress', orders: columns.in_progress, tone: tokens.secondary },
    { key: 'ready' as const, title: 'Ready', orders: columns.ready, tone: tokens.success },
  ];

  return (
    <View style={[styles.screen, { paddingTop: insets.top + tokens.spacing.md }]}>
      <View style={styles.header}>
        <View style={styles.headerMain}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Location: ${operator.location.name}. Change`}
            onPress={() => setSheet('location')}
            style={({ pressed }) => [styles.headerChip, pressed && styles.pressed]}
          >
            <Text numberOfLines={1} style={styles.headerChipText}>{operator.location.name}</Text>
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
        </View>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.headerActions}
        >
          <HeaderButton label="Menu" onPress={() => setSheet('menu')} />
          <HeaderButton label="Day" onPress={() => setSheet('day')} />
          <HeaderButton label="Settings" onPress={() => setSheet('settings')} />
          <HeaderButton label="Lock" onPress={() => setLocked(true)} />
        </ScrollView>
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
        horizontal={!allColumnsVisible}
        pagingEnabled={!allColumnsVisible && layout.boardColumnsVisible === 1}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={[styles.columns, allColumnsVisible && styles.columnsWide]}
        style={styles.columnsScroll}
      >
        {columnData.map((column) => (
          <View
            key={column.key}
            style={[
              styles.column,
              !allColumnsVisible && {
                flexGrow: 0,
                flexShrink: 0,
                flexBasis: 'auto',
                width: visibleColumnWidth,
              },
            ]}
          >
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
  const tokens = useBrandTokens();
  const styles = createStyles(tokens);
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
  const tokens = useBrandTokens();
  const styles = createStyles(tokens);
  const action = nextActionFor(order);
  const paymentDue = isPaymentDue(order);
  const actionLabel = paymentDue ? `Collect ${formatMoney(order.totalCents)}` : action?.label;
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
      {order.lines.map((line, index) => {
        const packLabel = packContentsLabel(line.packContents ?? []);
        return (
        <View key={index}>
          <Text style={[styles.cardLine, kds && styles.cardLineKds]} numberOfLines={2}>
            {line.quantity}× {line.name}
            {line.options.length > 0 ? ` · ${line.options.join(', ')}` : ''}
          </Text>
          {packLabel ? <Text style={styles.cardNote}>{packLabel}</Text> : null}
          {line.note ? <Text style={styles.cardNote}>“{line.note}”</Text> : null}
        </View>
        );
      })}
      {order.note ? <Text style={styles.cardNote}>“{order.note}”</Text> : null}
      <View style={styles.cardBottom}>
        {kds ? <View /> : (
          <Text style={styles.cardTotal}>{paymentDue ? 'Due ' : ''}{formatMoney(order.totalCents)}</Text>
        )}
        {action ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${actionLabel} for order ${order.shortCode}`}
            onPress={() => onAdvance(action.to)}
            style={({ pressed }) => [styles.advance, pressed && styles.pressed]}
          >
            <Text style={styles.advanceText}>{actionLabel}</Text>
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
  const tokens = useBrandTokens();
  const styles = createStyles(tokens);
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const sheetWidth = Math.min(640, Math.max(0, width - tokens.spacing.xl * 2));
  const sheetInset = Math.max(tokens.spacing.xl, (width - sheetWidth) / 2);
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} style={styles.backdrop} />
      <View style={[styles.sheet, {
        left: sheetInset,
        right: sheetInset,
        paddingBottom: Math.max(tokens.spacing.xl, insets.bottom + tokens.spacing.xl),
      }]}>
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
  const tokens = useBrandTokens();
  const styles = createStyles(tokens);
  const [refundOpen, setRefundOpen] = useState(false);
  const [refundAmount, setRefundAmount] = useState('');
  useEffect(() => {
    if (!order) {
      setRefundOpen(false);
      setRefundAmount('');
    }
  }, [order]);
  if (!order) return null;
  const action = nextActionFor(order);
  const paymentDue = isPaymentDue(order);
  const actionLabel = paymentDue ? `Collect ${formatMoney(order.totalCents)}` : action?.label;
  const partialCents = Math.round(Number.parseFloat(refundAmount.replace(/[^0-9.]/g, '') || '0') * 100);
  return (
    <SheetShell visible title={`Order ${order.shortCode} · ${order.guestName}`} onClose={onClose}>
      {order.lines.map((line, index) => {
        const packLabel = packContentsLabel(line.packContents ?? []);
        return (
        <View key={index} style={styles.detailLine}>
          <Text style={styles.detailLineName}>{line.quantity}× {line.name}</Text>
          {line.options.length > 0 ? <Text style={styles.detailLineOptions}>{line.options.join(' · ')}</Text> : null}
          {packLabel ? <Text style={styles.detailLineOptions}>{packLabel}</Text> : null}
          {line.note ? <Text style={styles.detailLineOptions}>“{line.note}”</Text> : null}
        </View>
        );
      })}
      {order.note ? <Text style={styles.cardNote}>“{order.note}”</Text> : null}
      <View style={styles.detailTotalRow}>
        <Text style={styles.detailTotalLabel}>{paymentDue ? 'Due at pickup' : 'Paid'}</Text>
        <Text style={styles.detailTotalValue}>{formatMoney(order.totalCents)}</Text>
      </View>

      {action ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${actionLabel} for order ${order.shortCode}`}
          onPress={() => { onAdvance(action.to); onClose(); }}
          style={({ pressed }) => [styles.detailPrimary, pressed && styles.pressed]}
        >
          <Text style={styles.detailPrimaryText}>{actionLabel}</Text>
        </Pressable>
      ) : null}

      {order.status !== 'refunded' && order.status !== 'cancelled' ? (
        <View style={styles.detailDangerRow}>
          {canCancelWithoutRefund(order) ? (
            <Pressable accessibilityRole="button" onPress={onCancel} style={({ pressed }) => [styles.detailQuiet, pressed && styles.pressed]}>
              <Text style={styles.detailQuietText}>Cancel order</Text>
            </Pressable>
          ) : null}
          {!paymentDue ? (
            <Pressable
              accessibilityRole="button"
              {...toggleState(refundOpen)}
              onPress={() => setRefundOpen((open) => !open)}
              style={({ pressed }) => [styles.detailQuiet, pressed && styles.pressed]}
            >
              <Text style={styles.detailQuietText}>Refund…</Text>
            </Pressable>
          ) : null}
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
            placeholderTextColor={tokens.textMuted}
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
  const tokens = useBrandTokens();
  const styles = createStyles(tokens);
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
  const tokens = useBrandTokens();
  const styles = createStyles(tokens);
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
        placeholderTextColor={tokens.textMuted}
        style={styles.refundInput}
      />
      <Text style={styles.sheetSection}>86 board</Text>
      <Text style={styles.refundHint}>
        86&rsquo;d items stay on the menu marked sold out today and cannot be added
        to a bag. Everything resets at open.
      </Text>
      {operator.menuItems.length === 0 ? (
        <Text style={styles.refundHint}>
          This shop&rsquo;s menu has not loaded yet. Nothing can be 86&rsquo;d until it does.
        </Text>
      ) : null}
      {operator.menuItems.map((item) => {
        const is86d = operator.eightySixed.has(item.slug);
        return (
          <Pressable
            key={item.slug}
            accessibilityRole="switch"
            {...toggleState(is86d)}
            accessibilityLabel={`${item.name}. ${is86d ? '86’d — tap to restore' : 'Available — tap to 86'}`}
            onPress={() => operator.toggleEightySix(item.slug)}
            style={({ pressed }) => [styles.eightySixRow, pressed && styles.pressed]}
          >
            <Text style={[styles.locationName, is86d && styles.eightySixName]}>{item.name}</Text>
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
  const tokens = useBrandTokens();
  const styles = createStyles(tokens);
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
  const tokens = useBrandTokens();
  const styles = createStyles(tokens);
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
  const tokens = useBrandTokens();
  const styles = createStyles(tokens);
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
  const tokens = useBrandTokens();
  const styles = createStyles(tokens);
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

const createStyles = (tokens: BrandTokens) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: tokens.surface },
  pressed: { opacity: 0.8 },

  header: {
    gap: tokens.spacing.md,
    paddingHorizontal: tokens.spacing.xl,
    paddingBottom: tokens.spacing.md,
  },
  headerMain: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: tokens.spacing.md, minHeight: 44 },
  headerTitle: { color: tokens.textPrimary, fontFamily: tokens.fontDisplay, fontSize: 24, flexShrink: 0 },
  headerChip: {
    maxWidth: '48%',
    minHeight: 44,
    flexShrink: 1,
    justifyContent: 'center',
    paddingHorizontal: tokens.spacing.lg,
    paddingVertical: tokens.spacing.sm,
    borderRadius: tokens.radius.pill,
    backgroundColor: tokens.surface,
  },
  headerChipText: { color: tokens.primary, fontFamily: tokens.fontBody, fontSize: 13, flexShrink: 1 },
  headerActions: { flexDirection: 'row', gap: tokens.spacing.md, paddingRight: tokens.spacing.xs },
  headerButton: {
    paddingHorizontal: tokens.spacing.lg,
    paddingVertical: tokens.spacing.md,
    borderRadius: tokens.radius.pill,
    backgroundColor: tokens.surfaceElevated,
    borderWidth: 1,
    borderColor: tokens.secondary,
  },
  headerButtonText: { color: tokens.textPrimary, fontFamily: tokens.fontBody, fontSize: 13 },
  newBadge: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: tokens.spacing.lg,
    paddingVertical: tokens.spacing.sm,
    borderRadius: tokens.radius.pill,
    backgroundColor: tokens.danger,
  },
  newBadgeText: { color: tokens.surfaceElevated, fontFamily: tokens.fontBody, fontSize: 13 },

  lane: { paddingBottom: tokens.spacing.md },
  laneTitle: { color: tokens.textMuted, fontFamily: tokens.fontBody, fontSize: 12, letterSpacing: 0.6, textTransform: 'uppercase', paddingHorizontal: tokens.spacing.xl, paddingBottom: tokens.spacing.sm },
  laneRow: { gap: tokens.spacing.md, paddingHorizontal: tokens.spacing.xl },
  laneCard: {
    paddingHorizontal: tokens.spacing.lg,
    paddingVertical: tokens.spacing.md,
    borderRadius: tokens.radius.lg,
    backgroundColor: tokens.surface,
    borderWidth: 1,
    borderColor: tokens.accent,
    alignItems: 'center',
    gap: 2,
  },
  laneCode: { color: tokens.textPrimary, fontFamily: tokens.fontBody, fontSize: 15 },
  laneWhen: { color: tokens.textMuted, fontFamily: tokens.fontBody, fontSize: 12 },

  columnsScroll: { flex: 1 },
  columns: { paddingHorizontal: tokens.spacing.xl, gap: tokens.spacing.lg, paddingBottom: tokens.spacing.xxl },
  // Side-by-side columns above the breakpoint; the vertical ScrollView's
  // content container needs the row direction stated, or the columns stack.
  columnsWide: { flex: 1, flexDirection: 'row' },
  column: {
    flex: 1,
    borderRadius: tokens.radius.lg,
    backgroundColor: tokens.surface,
    padding: tokens.spacing.md,
  },
  columnHeader: { flexDirection: 'row', alignItems: 'center', gap: tokens.spacing.md, padding: tokens.spacing.md },
  columnDot: { width: 10, height: 10, borderRadius: 5 },
  columnTitle: { flex: 1, color: tokens.textPrimary, fontFamily: tokens.fontBody, fontSize: 16 },
  columnCount: { color: tokens.textMuted, fontFamily: tokens.fontBody, fontSize: 16 },
  columnBody: { gap: tokens.spacing.md, paddingBottom: tokens.spacing.xl },
  columnEmpty: { color: tokens.textMuted, fontFamily: tokens.fontBody, fontSize: 14, textAlign: 'center', paddingVertical: tokens.spacing.xxl },

  card: {
    borderRadius: tokens.radius.lg,
    backgroundColor: tokens.surfaceElevated,
    padding: tokens.spacing.lg,
    gap: tokens.spacing.sm,
    shadowColor: tokens.textPrimary, shadowOffset: { width: 0, height: 8 }, shadowOpacity: tokens.elevation.card, shadowRadius: 24, elevation: 5,
  },
  cardFresh: { borderWidth: 2, borderColor: tokens.danger },
  cardTop: { flexDirection: 'row', alignItems: 'baseline', flexWrap: 'wrap', gap: tokens.spacing.md },
  cardCode: { color: tokens.textPrimary, fontFamily: tokens.fontBody, fontSize: 18 },
  cardCodeKds: { fontSize: 26 },
  cardQueue: {
    color: tokens.textMuted ?? tokens.textPrimary,
    fontFamily: tokens.fontBody,
    fontSize: 14,
    fontVariant: ['tabular-nums'],
  },
  cardGuest: { flex: 1, minWidth: 80, color: tokens.textMuted, fontFamily: tokens.fontBody, fontSize: 14 },
  cardAge: { color: tokens.textMuted, fontFamily: tokens.fontBody, fontSize: 13 },
  cardLine: { color: tokens.textPrimary, fontFamily: tokens.fontBody, fontSize: 14, lineHeight: 20 },
  cardLineKds: { fontSize: 18, lineHeight: 26 },
  cardNote: { color: tokens.primary, fontFamily: tokens.fontBody, fontSize: 13, fontStyle: 'italic' },
  cardBottom: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: tokens.spacing.sm },
  cardTotal: { color: tokens.textMuted, fontFamily: tokens.fontBody, fontSize: 14 },
  advance: {
    minHeight: 44,
    minWidth: 110,
    borderRadius: tokens.radius.pill,
    backgroundColor: tokens.textPrimary,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: tokens.spacing.xl,
  },
  advanceText: { color: tokens.surfaceElevated, fontFamily: tokens.fontBody, fontSize: 15 },

  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: alpha(tokens.primary, 0.45),
  },
  sheet: {
    position: 'absolute',
    zIndex: 1,
    left: tokens.spacing.xl,
    right: tokens.spacing.xl,
    top: '12%',
    maxHeight: '76%',
    borderRadius: tokens.radius.lg,
    backgroundColor: tokens.surface,
    padding: tokens.spacing.xl,
    gap: tokens.spacing.lg,
    shadowColor: tokens.textPrimary, shadowOffset: { width: 0, height: 8 }, shadowOpacity: tokens.elevation.card, shadowRadius: 24, elevation: 5,
  },
  sheetTitle: { color: tokens.textPrimary, fontFamily: tokens.fontDisplay, fontSize: 20 },
  sheetBody: { gap: tokens.spacing.md },
  sheetSection: { color: tokens.textMuted, fontFamily: tokens.fontBody, fontSize: 12, letterSpacing: 0.6, textTransform: 'uppercase', paddingTop: tokens.spacing.md },

  detailLine: { gap: 2 },
  detailLineName: { color: tokens.textPrimary, fontFamily: tokens.fontBody, fontSize: 16 },
  detailLineOptions: { color: tokens.textMuted, fontFamily: tokens.fontBody, fontSize: 13 },
  detailTotalRow: { flexDirection: 'row', justifyContent: 'space-between', borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: tokens.secondary, paddingTop: tokens.spacing.md },
  detailTotalLabel: { color: tokens.textMuted, fontFamily: tokens.fontBody, fontSize: 14 },
  detailTotalValue: { color: tokens.textPrimary, fontFamily: tokens.fontBody, fontSize: 16 },
  detailPrimary: {
    minHeight: 52,
    borderRadius: tokens.radius.pill,
    backgroundColor: tokens.textPrimary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  detailPrimaryText: { color: tokens.surfaceElevated, fontFamily: tokens.fontBody, fontSize: 16 },
  detailDangerRow: { flexDirection: 'row', gap: tokens.spacing.md, flexWrap: 'wrap' },
  detailQuiet: {
    minHeight: 44,
    borderRadius: tokens.radius.pill,
    borderWidth: 1,
    borderColor: tokens.secondary,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: tokens.spacing.xl,
    backgroundColor: tokens.surfaceElevated,
  },
  detailQuietText: { color: tokens.textPrimary, fontFamily: tokens.fontBody, fontSize: 14 },
  detailDanger: {
    minHeight: 44,
    borderRadius: tokens.radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: tokens.spacing.xl,
    backgroundColor: tokens.danger,
  },
  detailDangerText: { color: tokens.surfaceElevated, fontFamily: tokens.fontBody, fontSize: 14 },
  refundBox: { gap: tokens.spacing.md },
  refundHint: { color: tokens.textMuted, fontFamily: tokens.fontBody, fontSize: 13, lineHeight: 18 },
  refundInput: {
    borderWidth: 1,
    borderColor: tokens.secondary,
    borderRadius: tokens.radius.lg,
    paddingHorizontal: tokens.spacing.lg,
    paddingVertical: tokens.spacing.md,
    color: tokens.textPrimary,
    fontFamily: tokens.fontBody,
    fontSize: 18,
    backgroundColor: tokens.surfaceElevated,
  },

  statRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: tokens.spacing.sm },
  statLabel: { color: tokens.textPrimary, fontFamily: tokens.fontBody, fontSize: 15 },
  statValue: { color: tokens.textPrimary, fontFamily: tokens.fontBody, fontSize: 15 },

  settingRow: { flexDirection: 'row', alignItems: 'center', gap: tokens.spacing.lg, paddingVertical: tokens.spacing.md },
  settingCopy: { flex: 1, gap: 2 },
  settingLabel: { color: tokens.textPrimary, fontFamily: tokens.fontBody, fontSize: 15 },
  settingDetail: { color: tokens.textMuted, fontFamily: tokens.fontBody, fontSize: 13 },
  switch: {
    width: 52,
    height: 32,
    borderRadius: 16,
    backgroundColor: tokens.secondary,
    padding: 3,
    justifyContent: 'center',
  },
  switchOn: { backgroundColor: tokens.success },
  switchKnob: { width: 26, height: 26, borderRadius: 13, backgroundColor: tokens.surfaceElevated },
  switchKnobOn: { alignSelf: 'flex-end' },

  eightySixRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: tokens.spacing.md },
  eightySixName: { color: tokens.textMuted, textDecorationLine: 'line-through' },
  eightySixTag: { color: tokens.danger, fontFamily: tokens.fontBody, fontSize: 13 },
  locationRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: tokens.spacing.lg },
  locationName: { color: tokens.textPrimary, fontFamily: tokens.fontBody, fontSize: 16 },
  locationCurrent: { color: tokens.success, fontFamily: tokens.fontBody, fontSize: 13 },

  pinScreen: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: tokens.spacing.lg, padding: tokens.spacing.xxl, backgroundColor: tokens.surface },
  pinTitle: { color: tokens.textPrimary, fontFamily: tokens.fontDisplay, fontSize: 26 },
  pinHint: { color: tokens.textMuted, fontFamily: tokens.fontBody, fontSize: 14, textAlign: 'center' },
  pinInput: {
    minWidth: 180,
    textAlign: 'center',
    borderWidth: 1,
    borderColor: tokens.secondary,
    borderRadius: tokens.radius.lg,
    paddingHorizontal: tokens.spacing.lg,
    paddingVertical: tokens.spacing.lg,
    color: tokens.textPrimary,
    fontFamily: tokens.fontBody,
    fontSize: 24,
    letterSpacing: 8,
    backgroundColor: tokens.surfaceElevated,
  },
});
