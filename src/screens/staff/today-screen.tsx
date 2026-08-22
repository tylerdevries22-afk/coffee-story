import { useState } from 'react';
import { Alert, Animated, Pressable, StyleSheet, Text, View } from 'react-native';

import { CollapsingPageHeader } from '@/components/collapsing-page-header';
import { StatTile, StatusBadge, WorkspaceCard } from '@/components/staff/workspace-ui';
import { Body, Button, Card, Screen, SectionTitle } from '@/components/ui';
import { appointmentMinutes, formatClockTime, formatMoney, sourceLabel } from '@/features/staff/workspace';
import { useAppState } from '@/state/app-context';
import { colors, fonts, radius, spacing } from '@/theme/tokens';
import type { PortalAppointment, StaffDashboard, StaffPayment } from '@/types/domain';
import { AppIcon } from '@/components/icon';

/** Callback shape shared by the hero card, the agenda rows and the alert flow. */
type StatusUpdater = (id: string, status: 'confirmed' | 'cancelled' | 'no_show') => Promise<void>;

/** Plot height of the income bars. Labels sit underneath, outside the track. */
const CHART_HEIGHT = 92;

/** Visible sliver so a zero-revenue day still reads as a bar, not a gap. */
const MIN_BAR_HEIGHT = 4;

const PAYMENT_METHOD_LABEL: Record<StaffPayment['method'], string> = {
  card: 'Card',
  cash: 'Cash',
  gift_card: 'Gift card',
};

type AttentionRow = {
  key: string;
  title: string;
  hint: string;
  actionLabel: string;
  onPress: () => void;
};

/**
 * Staff "Today" tab, at parity with the web admin dashboard: greeting, KPI
 * tiles with period-over-period deltas, an attention queue, the next visit,
 * income and booking-source charts, reputation, recent payments, and the
 * day's agenda.
 */
export function TodayScreen({ dashboard, onUpdateStatus }: {
  dashboard: StaffDashboard;
  onUpdateStatus: (id: string, status: 'confirmed' | 'cancelled' | 'no_show') => Promise<void>;
}) {
  const { setStaffTab } = useAppState();
  const [scrollY] = useState(() => new Animated.Value(0));
  const now = new Date();
  const today = now.toDateString();

  const appointments = dashboard.appointments
    .filter((appointment) => new Date(appointment.startsAt).toDateString() === today)
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const activeAppointments = appointments.filter((appointment) => (
    appointment.status !== 'cancelled' && appointment.status !== 'completed' && appointment.status !== 'no_show'
  ));
  const next = activeAppointments.find((appointment) => new Date(appointment.endsAt) > now) ?? activeAppointments[0];

  const metrics = dashboard.metrics;
  const attention = attentionRows(dashboard, appointments, setStaffTab);
  const trend = metrics?.revenueTrend ?? [];
  const trendPeak = trend.reduce((peak, point) => Math.max(peak, point.cents), 0);
  const sources = metrics?.bookingSources ?? [];
  const sourcePeak = sources.reduce((peak, entry) => Math.max(peak, entry.count), 0);
  const payments = dashboard.recentPayments ?? [];
  const filledStars = Math.round(dashboard.reputation?.score ?? 0);

  return (
    <Screen
      stickyHeaderIndices={[0]}
      contentContainerStyle={{ paddingTop: 0 }}
      onScroll={(event) => scrollY.setValue(event.nativeEvent.contentOffset.y)}
      scrollEventThrottle={16}
    >
      <CollapsingPageHeader title={greeting(now)} scrollY={scrollY} />
      <Text style={styles.subtitle}>
        {`${formatDayLabel(now)} · ${appointments.length} ${appointments.length === 1 ? 'appointment' : 'appointments'} today`}
      </Text>

      <View style={styles.tiles}>
        {metrics ? (
          <>
            <StatTile
              label="Today's revenue"
              value={formatMoney(metrics.todayRevenueCents)}
              current={metrics.todayRevenueCents}
              previous={metrics.previous?.todayRevenueCents}
            />
            <StatTile
              label="Orders"
              value={String(metrics.appointmentCount)}
              current={metrics.appointmentCount}
              previous={metrics.previous?.appointmentCount}
            />
            <StatTile label="New guests" value={String(metrics.newClientCount)} hint="this week" />
            <StatTile label="Return rate" value={`${metrics.rebookRatePct}%`} hint="30-day" />
          </>
        ) : (
          <>
            <StatTile label="Orders" value={String(appointments.length)} />
            <StatTile label="Open time" value={`${dashboard.openMinutes}m`} />
            <StatTile label="Projected" value={formatMoney(dashboard.projectedCents)} />
          </>
        )}
      </View>

      {attention.length ? (
        <WorkspaceCard title="Items needing your attention">
          {attention.map((row) => (
            <View key={row.key} style={styles.attentionRow}>
              <View style={styles.attentionCopy}>
                <Text style={styles.attentionTitle}>{row.title}</Text>
                <Text style={styles.attentionHint}>{row.hint}</Text>
              </View>
              <Button
                label="Do it"
                variant="secondary"
                accessibilityLabel={row.actionLabel}
                style={styles.attentionButton}
                onPress={row.onPress}
              />
            </View>
          ))}
        </WorkspaceCard>
      ) : null}

      {next ? (
        <Card style={styles.nextCard}>
          <Text style={styles.nextLabel}>Next visit</Text>
          <Text style={styles.nextTime}>{formatClockTime(next.startsAt)}</Text>
          <Text style={styles.nextName}>{next.clientName ?? 'Guest client'}</Text>
          <Body>{next.serviceName} · {appointmentMinutes(next)} minutes</Body>
          <View style={styles.actions}>
            <Button
              label={next.status === 'confirmed' ? 'Confirmed' : 'Confirm visit'}
              disabled={next.status === 'confirmed'}
              style={styles.actionButton}
              onPress={() => void runStatusUpdate(next.id, 'confirmed', onUpdateStatus)}
            />
            <Button
              label="Open checkout"
              variant="secondary"
              style={styles.actionButton}
              onPress={() => setStaffTab('checkout')}
            />
          </View>
        </Card>
      ) : <Card><Body muted>No appointments are scheduled today.</Body></Card>}

      {trend.length ? (
        <WorkspaceCard title="Income">
          <View style={styles.chart}>
            {trend.map((point) => (
              <View
                key={point.label}
                accessible
                accessibilityLabel={`${point.label}: ${formatMoney(point.cents)}`}
                style={styles.chartColumn}
              >
                <View style={styles.chartTrack}>
                  <View style={[styles.chartBar, { height: barHeight(point.cents, trendPeak) }]} />
                </View>
                <Text style={styles.chartLabel}>{point.label}</Text>
              </View>
            ))}
          </View>
        </WorkspaceCard>
      ) : null}

      {sources.length ? (
        <WorkspaceCard title="Booking activity">
          {sources.map((entry) => (
            <View
              key={entry.source}
              accessible
              accessibilityLabel={`${sourceLabel(entry.source) ?? entry.source}: ${entry.count} bookings`}
              style={styles.sourceRow}
            >
              <Text style={styles.sourceLabel}>{sourceLabel(entry.source) ?? entry.source}</Text>
              <View style={styles.sourceTrack}>
                <View style={[styles.sourceFill, { width: `${barPercent(entry.count, sourcePeak)}%` }]} />
              </View>
              <Text style={styles.sourceCount}>{entry.count}</Text>
            </View>
          ))}
        </WorkspaceCard>
      ) : null}

      {dashboard.reputation ? (
        <WorkspaceCard title="Reputation">
          <Text style={styles.reputationScore}>{dashboard.reputation.score.toFixed(1)}</Text>
          <View
            accessible
            accessibilityLabel={`${dashboard.reputation.score.toFixed(1)} out of 5 stars`}
            style={styles.stars}
          >
            {[0, 1, 2, 3, 4].map((index) => (
              <AppIcon
                key={index}
                name={index < filledStars ? 'star.fill' : 'star'}
                size={18}
                tintColor={colors.gold500}
              />
            ))}
          </View>
          <Text style={styles.reputationCount}>{`${dashboard.reputation.reviewCount} reviews`}</Text>
        </WorkspaceCard>
      ) : null}

      {payments.length ? (
        <WorkspaceCard title="Recent payments">
          {payments.map((payment) => (
            <View key={payment.id} style={styles.paymentRow}>
              <View style={styles.paymentCopy}>
                <Text style={styles.paymentName}>{payment.clientName}</Text>
                <Text style={styles.paymentDetail}>
                  {`${payment.itemName} · ${PAYMENT_METHOD_LABEL[payment.method]}`}
                </Text>
              </View>
              <Text style={styles.paymentAmount}>{formatMoney(payment.amountCents)}</Text>
            </View>
          ))}
        </WorkspaceCard>
      ) : null}

      <SectionTitle>Today&apos;s schedule</SectionTitle>
      {appointments.length ? appointments.map((appointment) => (
        <Pressable
          key={appointment.id}
          accessibilityRole="button"
          accessibilityLabel={`${formatClockTime(appointment.startsAt)} · ${appointment.clientName ?? 'Guest client'} · ${appointment.serviceName}. Update visit status.`}
          onPress={() => promptAppointmentStatus(appointment, onUpdateStatus)}
          style={({ pressed }) => [styles.scheduleRow, pressed && styles.pressed]}
        >
          <Text style={styles.scheduleTime}>{formatClockTime(appointment.startsAt)}</Text>
          <View style={styles.scheduleCopy}>
            <Text style={styles.scheduleName}>{appointment.clientName ?? 'Guest client'}</Text>
            <Text style={styles.scheduleService}>{appointment.serviceName}</Text>
            <StatusBadge status={appointment.status} />
          </View>
          <Text style={styles.schedulePrice}>{formatMoney(appointment.subtotalCents)}</Text>
        </Pressable>
      )) : <Card><Body muted>No appointments are scheduled today.</Body></Card>}
    </Screen>
  );
}

function greeting(now: Date): string {
  const hour = now.getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

function formatDayLabel(day: Date): string {
  return new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric' }).format(day);
}

function barHeight(value: number, peak: number): number {
  if (peak <= 0) return MIN_BAR_HEIGHT;
  return Math.max(MIN_BAR_HEIGHT, Math.round((value / peak) * CHART_HEIGHT));
}

function barPercent(value: number, peak: number): number {
  if (peak <= 0) return 0;
  return Math.max(4, Math.round((value / peak) * 100));
}

/**
 * The queue the web dashboard shows above the fold. Rows are derived from the
 * dashboard rather than hard-coded, and a zero count drops its row entirely so
 * the card never claims work that does not exist.
 */
function attentionRows(
  dashboard: StaffDashboard,
  todaysAppointments: readonly PortalAppointment[],
  setStaffTab: (tab: 'checkout' | 'clients') => void,
): AttentionRow[] {
  const toCheckOut = todaysAppointments.filter((appointment) => (
    appointment.status === 'confirmed' || appointment.status === 'pending'
  )).length;

  const clientIdByName = new Map(dashboard.clients.map((client) => [client.fullName, client.id]));
  const documented = new Set((dashboard.soapNotes ?? []).map((note) => note.customerId));
  const notesToWrite = todaysAppointments.filter((appointment) => {
    if (appointment.status !== 'completed') return false;
    const clientId = appointment.clientName ? clientIdByName.get(appointment.clientName) : undefined;
    return clientId === undefined || !documented.has(clientId);
  }).length;

  const rows: (AttentionRow | null)[] = [
    toCheckOut > 0 ? {
      key: 'checkout',
      title: `${toCheckOut} ${toCheckOut === 1 ? 'appointment' : 'appointments'} to check out`,
      hint: 'Collect payment before end of day',
      actionLabel: 'Open checkout',
      onPress: () => setStaffTab('checkout'),
    } : null,
    notesToWrite > 0 ? {
      key: 'soap',
      title: `${notesToWrite} order ${notesToWrite === 1 ? 'note' : 'notes'} to write`,
      hint: 'From the past 7 days',
      actionLabel: 'Open guests to write order notes',
      onPress: () => setStaffTab('clients'),
    } : null,
  ];
  return rows.filter((row): row is AttentionRow => row !== null);
}

async function runStatusUpdate(
  appointmentId: string,
  status: 'confirmed' | 'cancelled' | 'no_show',
  onUpdateStatus: StatusUpdater,
) {
  try {
    await onUpdateStatus(appointmentId, status);
  } catch (statusError) {
    Alert.alert('Visit not updated', statusError instanceof Error ? statusError.message : 'Try again in a moment.');
  }
}

function promptAppointmentStatus(appointment: PortalAppointment, onUpdateStatus: StatusUpdater) {
  Alert.alert(appointment.clientName ?? 'Guest client', `${appointment.serviceName}\nChoose a visit status.`, [
    { text: 'Close', style: 'cancel' },
    { text: 'Confirm', onPress: () => void runStatusUpdate(appointment.id, 'confirmed', onUpdateStatus) },
    { text: 'No show', onPress: () => void runStatusUpdate(appointment.id, 'no_show', onUpdateStatus) },
    { text: 'Cancel visit', style: 'destructive', onPress: () => void runStatusUpdate(appointment.id, 'cancelled', onUpdateStatus) },
  ]);
}

const styles = StyleSheet.create({
  subtitle: { color: colors.ink500, fontFamily: fonts.sans, fontSize: 14, lineHeight: 20, marginTop: -spacing.xs },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },

  attentionRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xs },
  attentionCopy: { flex: 1, gap: 2 },
  attentionTitle: { color: colors.ink900, fontFamily: fonts.sansBold, fontSize: 15 },
  attentionHint: { color: colors.ink500, fontFamily: fonts.sans, fontSize: 12 },
  attentionButton: { minHeight: 40, paddingHorizontal: spacing.md },

  nextCard: { backgroundColor: colors.brand700, gap: spacing.sm },
  nextLabel: { color: colors.brand300, fontFamily: fonts.sansBold, fontSize: 11, letterSpacing: 1.2, textTransform: 'uppercase' },
  nextTime: { color: colors.brand200, fontFamily: fonts.sansBold, fontSize: 13 },
  nextName: { color: colors.white, fontFamily: fonts.display, fontSize: 28 },
  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  actionButton: { flex: 1, minHeight: 46 },

  chart: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.xs, paddingTop: spacing.xs },
  chartColumn: { flex: 1, alignItems: 'center', gap: 6 },
  chartTrack: { height: CHART_HEIGHT, width: '100%', justifyContent: 'flex-end' },
  chartBar: { width: '100%', borderRadius: radius.sm, backgroundColor: colors.brand500 },
  chartLabel: { color: colors.ink500, fontFamily: fonts.sansMedium, fontSize: 11 },

  sourceRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 5 },
  sourceLabel: { width: 96, color: colors.ink700, fontFamily: fonts.sansMedium, fontSize: 13 },
  sourceTrack: { flex: 1, height: 8, borderRadius: radius.pill, backgroundColor: colors.brand50, overflow: 'hidden' },
  sourceFill: { height: 8, borderRadius: radius.pill, backgroundColor: colors.brand500 },
  sourceCount: { width: 32, textAlign: 'right', color: colors.ink900, fontFamily: fonts.sansBold, fontSize: 13 },

  reputationScore: { color: colors.ink900, fontFamily: fonts.display, fontSize: 34 },
  stars: { flexDirection: 'row', gap: 4 },
  reputationCount: { color: colors.ink500, fontFamily: fonts.sans, fontSize: 13 },

  paymentRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xs },
  paymentCopy: { flex: 1, gap: 2 },
  paymentName: { color: colors.ink900, fontFamily: fonts.sansBold, fontSize: 15 },
  paymentDetail: { color: colors.ink500, fontFamily: fonts.sans, fontSize: 12 },
  paymentAmount: { color: colors.ink900, fontFamily: fonts.sansBold, fontSize: 15, textAlign: 'right' },

  scheduleRow: {
    minHeight: 82,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.ink200,
  },
  scheduleTime: { width: 60, color: colors.ink700, fontFamily: fonts.sansBold, fontSize: 13 },
  scheduleCopy: { flex: 1, gap: 4 },
  scheduleName: { color: colors.ink900, fontFamily: fonts.sansBold, fontSize: 15 },
  scheduleService: { color: colors.ink500, fontFamily: fonts.sans, fontSize: 12 },
  schedulePrice: { color: colors.ink900, fontFamily: fonts.sansBold, fontSize: 15 },
  pressed: { opacity: 0.72 },
});
