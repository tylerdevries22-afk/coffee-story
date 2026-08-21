import { useMemo, useState } from 'react';
import { Alert, Animated, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  Avatar,
  EmptyState,
  GapStrip,
  IconButton,
  SourceBadge,
  StatusBadge,
  ViewSwitcher,
  WorkspaceCard,
} from '@/components/staff/workspace-ui';
import { CollapsingPageHeader } from '@/components/collapsing-page-header';
import { Button, Screen } from '@/components/ui';
import {
  addDays,
  agendaTotalCents,
  appointmentMinutes,
  appointmentsOn,
  CALENDAR_VIEWS,
  formatClockTime,
  formatMoney,
  monthGrid,
  scheduleStrip,
  sourceLabel,
  startOfWeek,
  type CalendarView,
} from '@/features/staff/workspace';
import { colors, fonts, radius, spacing } from '@/theme/tokens';
import type { BookingSource, PortalAppointment } from '@/types/domain';
import { toggleState } from '@/lib/a11y-state';

type VisitStatus = 'confirmed' | 'cancelled' | 'no_show';

/** Day-grid window, matching the web schedule's 9am–6pm working column. */
const DAY_START_HOUR = 9;
const DAY_END_HOUR = 18;
/** Vertical density of the day grid. One minute of care is 1.15pt tall. */
const PX_PER_MIN = 1.15;
/** Below this height a block only has room for the time and the client. */
const SERVICE_LINE_MIN_HEIGHT = 46;

const DAY_LABEL = new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
const WEEKDAY_LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'] as const;

/** Where the visit came from → badge tone, mirroring the web admin legend. */
const SOURCE_TONE: Record<BookingSource, 'plum' | 'amber' | 'green' | 'gray'> = {
  website: 'plum',
  directory: 'amber',
  campaign: 'green',
  staff: 'gray',
};

/** Status → rail colour on the agenda row and the day block. */
const STATUS_RAIL: Record<PortalAppointment['status'], string> = {
  confirmed: colors.success,
  pending: colors.warning,
  completed: colors.brand600,
  cancelled: colors.ink300,
  no_show: colors.danger,
};

export function CalendarScreen({ appointments, onUpdateStatus }: {
  appointments: PortalAppointment[];
  onUpdateStatus: (id: string, status: VisitStatus) => Promise<void>;
}) {
  const [view, setView] = useState<CalendarView>('Agenda');
  const [selectedDay, setSelectedDay] = useState(() => new Date());
  const [query, setQuery] = useState('');
  const [detailId, setDetailId] = useState<string | null>(null);
  const [scrollY] = useState(() => new Animated.Value(0));

  const needle = query.trim().toLowerCase();
  const filtered = useMemo(
    () => appointments.filter((appointment) => matchesQuery(appointment, needle)),
    [appointments, needle],
  );
  const dayAppointments = useMemo(
    () => appointmentsOn(filtered, selectedDay),
    [filtered, selectedDay],
  );
  const detail = appointments.find((appointment) => appointment.id === detailId) ?? null;

  const weekStart = startOfWeek(selectedDay);
  const weekDays = Array.from({ length: 7 }, (_, index) => addDays(weekStart, index));
  const monthHasVisits = filtered.some((appointment) => sameMonth(appointment.startsAt, selectedDay));
  const weekHasVisits = weekDays.some((day) => appointmentsOn(filtered, day).length > 0);

  function step(direction: 1 | -1) {
    setSelectedDay((current) => shiftDay(current, view, direction));
  }

  function openDay(day: Date) {
    setSelectedDay(day);
    setView('Day');
  }

  async function applyStatus(appointmentId: string, status: VisitStatus) {
    try {
      await onUpdateStatus(appointmentId, status);
      setDetailId(null);
    } catch (statusError) {
      Alert.alert(
        'Visit not updated',
        statusError instanceof Error ? statusError.message : 'Try again in a moment.',
      );
    }
  }

  return (
    <Screen
      stickyHeaderIndices={[0]}
      contentContainerStyle={{ paddingTop: 0 }}
      onScroll={(event) => scrollY.setValue(event.nativeEvent.contentOffset.y)}
      scrollEventThrottle={16}
    >
      <CollapsingPageHeader title="Schedule" scrollY={scrollY} />
      <Text style={styles.subtitle}>Your day at a glance — bookings, buffers, and check-ins</Text>

      <View style={styles.navRow}>
        <IconButton label="Previous day" symbol="chevron.left" onPress={() => step(-1)} />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Jump to today"
          onPress={() => setSelectedDay(new Date())}
          style={({ pressed }) => [styles.todayPill, pressed && styles.pressed]}
        >
          <Text style={styles.todayPillText}>Today</Text>
        </Pressable>
        <IconButton label="Next day" symbol="chevron.right" onPress={() => step(1)} />
        <Text style={styles.navDate} numberOfLines={1}>{DAY_LABEL.format(selectedDay)}</Text>
      </View>

      <ViewSwitcher options={CALENDAR_VIEWS} value={view} onChange={setView} />

      <TextInput
        accessibilityLabel="Search orders"
        value={query}
        onChangeText={setQuery}
        placeholder="Search orders…"
        placeholderTextColor={colors.ink400}
        style={styles.search}
      />

      {view === 'Agenda' ? (
        dayAppointments.length ? (
          <WorkspaceCard title={agendaHeading(dayAppointments)}>
            {dayAppointments.map((appointment, index) => {
              const strip = scheduleStrip(appointment, dayAppointments[index + 1]);
              return (
                <View key={appointment.id} style={styles.agendaGroup}>
                  <AgendaRow appointment={appointment} onPress={() => setDetailId(appointment.id)} />
                  {strip ? <GapStrip kind={strip.kind} minutes={strip.minutes} /> : null}
                </View>
              );
            })}
          </WorkspaceCard>
        ) : <NoMatches />
      ) : null}

      {view === 'Day' ? (
        dayAppointments.length ? (
          <DayGrid appointments={dayAppointments} onSelect={setDetailId} />
        ) : <NoMatches />
      ) : null}

      {view === 'Week' ? (
        <>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.weekRow}
          >
            {weekDays.map((day) => (
              <WeekColumn
                key={day.toDateString()}
                day={day}
                count={appointmentsOn(filtered, day).length}
                selected={day.toDateString() === selectedDay.toDateString()}
                onPress={() => openDay(day)}
              />
            ))}
          </ScrollView>
          {weekHasVisits ? null : <NoMatches />}
        </>
      ) : null}

      {view === 'Month' ? (
        <>
          <MonthGrid
            appointments={filtered}
            selectedDay={selectedDay}
            onSelect={openDay}
          />
          {monthHasVisits ? null : <NoMatches />}
        </>
      ) : null}

      {detail ? (
        <Modal
          animationType="slide"
          visible
          onRequestClose={() => setDetailId(null)}
        >
          <VisitDetail
            appointment={detail}
            onClose={() => setDetailId(null)}
            onStatus={(status) => void applyStatus(detail.id, status)}
          />
        </Modal>
      ) : null}
    </Screen>
  );
}

function NoMatches() {
  return <EmptyState title="No orders match" message="Adjust your search to see more." />;
}

function AgendaRow({ appointment, onPress }: { appointment: PortalAppointment; onPress: () => void }) {
  const client = appointment.clientName ?? 'Guest client';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${formatClockTime(appointment.startsAt)}, ${client}, ${appointment.serviceName}`}
      onPress={onPress}
      style={({ pressed }) => [styles.agendaRow, pressed && styles.pressed]}
    >
      <View style={styles.agendaTime}>
        <Text style={styles.agendaClock}>{formatClockTime(appointment.startsAt)}</Text>
        <Text style={styles.agendaLength}>{appointmentMinutes(appointment)}m</Text>
      </View>
      <View style={[styles.rail, { backgroundColor: STATUS_RAIL[appointment.status] }]} />
      <View style={styles.agendaCopy}>
        <View style={styles.agendaNameRow}>
          <Text style={styles.agendaName} numberOfLines={1}>{client}</Text>
          {appointment.isNewClient ? <SourceBadge label="New guest" tone="green" /> : null}
        </View>
        {appointment.staffName ? (
          <Text style={styles.agendaService} numberOfLines={1}>
            {appointment.serviceName} · {appointment.staffName}
          </Text>
        ) : null}
        <SourceBadge
          label={sourceLabel(appointment.bookingSource) ?? 'Added by you'}
          tone={appointment.bookingSource ? SOURCE_TONE[appointment.bookingSource] : 'gray'}
        />
      </View>
      <View style={styles.agendaTrailing}>
        <StatusBadge status={appointment.status} />
        <Text style={styles.agendaPrice}>{formatMoney(appointment.subtotalCents)}</Text>
      </View>
    </Pressable>
  );
}

function DayGrid({
  appointments,
  onSelect,
}: {
  appointments: readonly PortalAppointment[];
  onSelect: (id: string) => void;
}) {
  const hours = Array.from({ length: DAY_END_HOUR - DAY_START_HOUR + 1 }, (_, index) => DAY_START_HOUR + index);
  const gridHeight = (DAY_END_HOUR - DAY_START_HOUR) * 60 * PX_PER_MIN;
  return (
    <View style={[styles.dayGrid, { height: gridHeight + spacing.lg }]}>
      {hours.map((hour) => (
        <View key={hour} style={[styles.hourRow, { top: (hour - DAY_START_HOUR) * 60 * PX_PER_MIN }]}>
          <Text style={styles.hourLabel}>{hourLabel(hour)}</Text>
          <View style={styles.hourRule} />
        </View>
      ))}
      {appointments.map((appointment) => {
        const top = Math.max(0, (minutesIntoDay(appointment.startsAt) - DAY_START_HOUR * 60) * PX_PER_MIN);
        const height = Math.max(24, appointmentMinutes(appointment) * PX_PER_MIN);
        const client = appointment.clientName ?? 'Guest client';
        return (
          <Pressable
            key={appointment.id}
            accessibilityRole="button"
            accessibilityLabel={`${formatClockTime(appointment.startsAt)}, ${client}, ${appointment.serviceName}`}
            onPress={() => onSelect(appointment.id)}
            style={({ pressed }) => [
              styles.dayBlock,
              { top, height, borderLeftColor: STATUS_RAIL[appointment.status] },
              pressed && styles.pressed,
            ]}
          >
            <Text style={styles.dayBlockTime}>{formatClockTime(appointment.startsAt)}</Text>
            <Text style={styles.dayBlockName} numberOfLines={1}>{client}</Text>
            {height > SERVICE_LINE_MIN_HEIGHT ? (
              <Text style={styles.dayBlockService} numberOfLines={1}>{appointment.serviceName}</Text>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}

function WeekColumn({
  day,
  count,
  selected,
  onPress,
}: {
  day: Date;
  count: number;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${DAY_LABEL.format(day)}, ${count} appointments`}
      {...toggleState(selected)}
      onPress={onPress}
      style={({ pressed }) => [styles.weekColumn, selected && styles.weekColumnActive, pressed && styles.pressed]}
    >
      <Text style={[styles.weekLetter, selected && styles.weekTextActive]}>
        {WEEKDAY_LETTERS[day.getDay()]}
      </Text>
      <Text style={[styles.weekDate, selected && styles.weekTextActive]}>{day.getDate()}</Text>
      <Text style={[styles.weekCount, selected && styles.weekTextActive]}>
        {count > 0 ? String(count) : '—'}
      </Text>
    </Pressable>
  );
}

function MonthGrid({
  appointments,
  selectedDay,
  onSelect,
}: {
  appointments: readonly PortalAppointment[];
  selectedDay: Date;
  onSelect: (day: Date) => void;
}) {
  const { leading, days } = monthGrid(selectedDay);
  const busy = new Set(
    appointments
      .filter((appointment) => sameMonth(appointment.startsAt, selectedDay))
      .map((appointment) => new Date(appointment.startsAt).getDate()),
  );
  return (
    <View>
      <View style={styles.monthHeader}>
        {WEEKDAY_LETTERS.map((letter, index) => (
          <Text key={`${letter}-${index}`} style={styles.monthHeaderText}>{letter}</Text>
        ))}
      </View>
      <View style={styles.monthGrid}>
        {Array.from({ length: leading }, (_, index) => (
          <View key={`blank-${index}`} style={styles.monthCell} />
        ))}
        {Array.from({ length: days }, (_, index) => {
          const date = index + 1;
          const day = new Date(selectedDay.getFullYear(), selectedDay.getMonth(), date);
          const selected = date === selectedDay.getDate();
          return (
            <Pressable
              key={date}
              accessibilityRole="button"
              accessibilityLabel={DAY_LABEL.format(day)}
              {...toggleState(selected)}
              onPress={() => onSelect(day)}
              style={({ pressed }) => [styles.monthCell, pressed && styles.pressed]}
            >
              <View style={[styles.monthDay, selected && styles.monthDayActive]}>
                <Text style={[styles.monthDayText, selected && styles.monthDayTextActive]}>{date}</Text>
              </View>
              {busy.has(date) ? <View style={styles.monthDot} /> : <View style={styles.monthDotSpacer} />}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function VisitDetail({
  appointment,
  onClose,
  onStatus,
}: {
  appointment: PortalAppointment;
  onClose: () => void;
  onStatus: (status: VisitStatus) => void;
}) {
  const insets = useSafeAreaInsets();
  const client = appointment.clientName ?? 'Guest client';
  const recovery = appointment.recoveryMinutes ?? 0;
  return (
    <ScrollView style={styles.modal} contentContainerStyle={[styles.modalContent, { paddingTop: insets.top + spacing.md }]}>
      <View style={styles.modalHeader}>
        <Avatar name={client} size={52} />
        <View style={styles.modalHeading}>
          <Text style={styles.modalName} numberOfLines={2}>{client}</Text>
          <Text style={styles.modalSubtitle} numberOfLines={2}>
            {formatClockTime(appointment.startsAt)}–{formatClockTime(appointment.endsAt)} · {appointment.serviceName}
          </Text>
        </View>
        <IconButton label="Close" symbol="xmark" onPress={onClose} />
      </View>

      <View style={styles.modalBadges}>
        <StatusBadge status={appointment.status} />
        <SourceBadge
          label={sourceLabel(appointment.bookingSource) ?? 'Added by you'}
          tone={appointment.bookingSource ? SOURCE_TONE[appointment.bookingSource] : 'gray'}
        />
        {appointment.isNewClient ? <SourceBadge label="New guest" tone="green" /> : null}
      </View>

      <View style={styles.modalFields}>
        <DetailField label="Date" value={DAY_LABEL.format(new Date(appointment.startsAt))} />
        <DetailField
          label="Time"
          value={`${formatClockTime(appointment.startsAt)}–${formatClockTime(appointment.endsAt)}`}
        />
        <DetailField label="Duration" value={`${appointmentMinutes(appointment)} min`} />
        <DetailField label="Service" value={appointment.serviceName} />
        <DetailField label="Barista" value={appointment.staffName ?? 'Unassigned'} />
        <DetailField label="Price" value={formatMoney(appointment.subtotalCents)} />
        {recovery > 0 ? <DetailField label="Recovery buffer" value={`${recovery} min after`} /> : null}
      </View>

      <Button label="Confirm" onPress={() => onStatus('confirmed')} />
      <View style={styles.modalActions}>
        <Button label="No show" variant="soft" style={styles.modalAction} onPress={() => onStatus('no_show')} />
        <Button label="Cancel order" variant="secondary" style={styles.modalAction} onPress={() => onStatus('cancelled')} />
      </View>
    </ScrollView>
  );
}

function DetailField({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <Text style={styles.fieldValue}>{value}</Text>
    </View>
  );
}

function agendaHeading(appointments: readonly PortalAppointment[]): string {
  const count = appointments.length;
  const noun = count === 1 ? 'appointment' : 'appointments';
  return `${count} ${noun} · ${formatMoney(agendaTotalCents(appointments))}`;
}

function matchesQuery(appointment: PortalAppointment, needle: string): boolean {
  if (!needle) return true;
  return `${appointment.clientName ?? ''} ${appointment.serviceName}`.toLowerCase().includes(needle);
}

function sameMonth(iso: string, day: Date): boolean {
  const date = new Date(iso);
  return date.getFullYear() === day.getFullYear() && date.getMonth() === day.getMonth();
}

function minutesIntoDay(iso: string): number {
  const date = new Date(iso);
  return date.getHours() * 60 + date.getMinutes();
}

function hourLabel(hour: number): string {
  const suffix = hour >= 12 ? 'pm' : 'am';
  const display = hour % 12 === 0 ? 12 : hour % 12;
  return `${display}${suffix}`;
}

/** Arrow travel: a day in Agenda/Day, a week in Week, a whole month in Month. */
function shiftDay(day: Date, view: CalendarView, direction: 1 | -1): Date {
  if (view === 'Month') {
    const target = new Date(day.getFullYear(), day.getMonth() + direction, 1);
    const daysInMonth = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
    target.setDate(Math.min(day.getDate(), daysInMonth));
    return target;
  }
  return addDays(day, view === 'Week' ? direction * 7 : direction);
}

const styles = StyleSheet.create({
  subtitle: { color: colors.ink500, fontFamily: fonts.sans, fontSize: 14, lineHeight: 20 },
  navRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  navDate: { flex: 1, textAlign: 'right', color: colors.ink900, fontFamily: fonts.sansBold, fontSize: 14 },
  todayPill: {
    minHeight: 40,
    justifyContent: 'center',
    borderRadius: radius.pill,
    backgroundColor: colors.brand600,
    paddingHorizontal: spacing.md,
  },
  todayPillText: { color: colors.white, fontFamily: fonts.sansBold, fontSize: 13 },
  search: {
    minHeight: 54,
    borderRadius: radius.pill,
    backgroundColor: colors.brand50,
    paddingHorizontal: spacing.lg,
    color: colors.ink900,
    fontFamily: fonts.sans,
    fontSize: 15,
  },
  agendaGroup: { gap: spacing.xs },
  agendaRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm },
  agendaTime: { width: 56, gap: 2 },
  agendaClock: { color: colors.ink900, fontFamily: fonts.sansBold, fontSize: 13 },
  agendaLength: { color: colors.ink400, fontFamily: fonts.sans, fontSize: 11 },
  rail: { width: 4, alignSelf: 'stretch', minHeight: 46, borderRadius: 2 },
  agendaCopy: { flex: 1, gap: 4 },
  agendaNameRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, flexWrap: 'wrap' },
  agendaName: { color: colors.ink900, fontFamily: fonts.sansBold, fontSize: 15, flexShrink: 1 },
  agendaService: { color: colors.ink500, fontFamily: fonts.sans, fontSize: 12 },
  agendaTrailing: { alignItems: 'flex-end', gap: 4 },
  agendaPrice: { color: colors.ink900, fontFamily: fonts.sansBold, fontSize: 14 },
  dayGrid: { position: 'relative' },
  hourRow: { position: 'absolute', left: 0, right: 0, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  hourLabel: { width: 46, color: colors.ink400, fontFamily: fonts.sansMedium, fontSize: 11 },
  hourRule: { flex: 1, height: 1, backgroundColor: colors.ink200 },
  dayBlock: {
    position: 'absolute',
    left: 58,
    right: 0,
    overflow: 'hidden',
    borderRadius: radius.sm,
    borderLeftWidth: 4,
    backgroundColor: colors.brand50,
    paddingHorizontal: spacing.sm,
    paddingVertical: 5,
    gap: 1,
  },
  dayBlockTime: { color: colors.brand600, fontFamily: fonts.sansBold, fontSize: 11 },
  dayBlockName: { color: colors.ink900, fontFamily: fonts.sansBold, fontSize: 13 },
  dayBlockService: { color: colors.ink500, fontFamily: fonts.sans, fontSize: 11 },
  weekRow: { gap: spacing.xs, paddingRight: spacing.md },
  weekColumn: {
    width: 62,
    minHeight: 96,
    borderRadius: radius.md,
    backgroundColor: colors.warm,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  weekColumnActive: { backgroundColor: colors.brand600 },
  weekLetter: { color: colors.ink500, fontFamily: fonts.sansBold, fontSize: 11 },
  weekDate: { color: colors.ink900, fontFamily: fonts.display, fontSize: 20 },
  weekCount: { color: colors.ink500, fontFamily: fonts.sansMedium, fontSize: 12 },
  weekTextActive: { color: colors.white },
  monthHeader: { flexDirection: 'row' },
  monthHeaderText: {
    width: '14.285%',
    textAlign: 'center',
    color: colors.ink500,
    fontFamily: fonts.sansBold,
    fontSize: 12,
  },
  monthGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  monthCell: { width: '14.285%', aspectRatio: 1, alignItems: 'center', justifyContent: 'center', gap: 3 },
  monthDay: { minWidth: 34, minHeight: 34, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  monthDayActive: { backgroundColor: colors.brand600 },
  monthDayText: { color: colors.ink700, fontFamily: fonts.sansMedium, fontSize: 14 },
  monthDayTextActive: { color: colors.white, fontFamily: fonts.sansBold },
  monthDot: { width: 5, height: 5, borderRadius: 2.5, backgroundColor: colors.gold500 },
  monthDotSpacer: { width: 5, height: 5 },
  modal: { flex: 1, backgroundColor: colors.surface },
  modalContent: { padding: spacing.lg, paddingTop: spacing.xxl, gap: spacing.md },
  modalHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  modalHeading: { flex: 1, gap: 3 },
  modalName: { color: colors.ink900, fontFamily: fonts.display, fontSize: 26, lineHeight: 30 },
  modalSubtitle: { color: colors.ink500, fontFamily: fonts.sans, fontSize: 13, lineHeight: 19 },
  modalBadges: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  modalFields: {
    borderRadius: radius.md,
    backgroundColor: colors.warm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  field: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md, minHeight: 42 },
  fieldLabel: { color: colors.ink500, fontFamily: fonts.sansMedium, fontSize: 13 },
  fieldValue: { flex: 1, textAlign: 'right', color: colors.ink900, fontFamily: fonts.sansBold, fontSize: 14 },
  modalActions: { flexDirection: 'row', gap: spacing.sm },
  modalAction: { flex: 1 },
  pressed: { opacity: 0.72 },
});
