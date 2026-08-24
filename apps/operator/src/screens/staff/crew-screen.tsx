import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import {
  fetchChecklist, fetchShiftRoster, type ChecklistItem as DataChecklistItem,
  type RosterEntry,
} from '@platform/data';
import { localIsoDate } from '@platform/domain';

import { CollapsingScreen } from '@/components/collapsing-screen';
import { Body, Card, SectionTitle } from '@/components/ui';
import { DEMO_CHECKLIST, DEMO_CREW_MEMBER, DEMO_SHIFTS } from '@/data/crew-demo';
import {
  itemsFor, outstandingAtClose, progressOf, toggleItem, type ChecklistItem, type ChecklistRecurrence,
} from '@/features/crew/checklist';
import {
  leavingSoon, minutesRemaining, shiftState, sortRoster, type Shift,
} from '@/features/crew/shift';
import { choiceState } from '@platform/ui';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/state/auth-context';
import { useOperator } from '@/state/operator-store';
import { useTokens as useBrandTokens, type BrandTokens } from '@platform/ui';

/**
 * Crew: who is on, and what the shift still owes.
 *
 * The one staff surface that is personal rather than device-paired -- it shows
 * names and attributes completed work to one, so it belongs to whoever is
 * signed in rather than to the tablet.
 *
 * Two questions, in the order a shift asks them: who is here, and what is left.
 */
export function CrewScreen() {
  const tokens = useBrandTokens();
  const styles = createStyles(tokens);
  const stateTone = {
    on: { backgroundColor: tokens.surfaceElevated },
    upcoming: { backgroundColor: tokens.surface },
    ended: { backgroundColor: tokens.secondary },
  } as const;
  const stateText = {
    on: tokens.success,
    upcoming: tokens.warning,
    ended: tokens.textMuted,
  } as const;
  const { isDemo, portal, tenant, user } = useAuth();
  const { location } = useOperator();
  const [checklist, setChecklist] = useState<readonly ChecklistItem[]>(() => isDemo ? DEMO_CHECKLIST : []);
  const [shifts, setShifts] = useState<readonly Shift[]>(() => isDemo ? DEMO_SHIFTS : []);
  // One clock for the whole render, so the roster and the "leaving soon" cue
  // can never disagree about what time it is.
  const now = useMemo(() => new Date(), []);

  const serviceDate = useMemo(() => localIsoDate(now), [now]);
  const roster = useMemo(() => sortRoster(shifts, now), [now, shifts]);
  const soon = useMemo(() => leavingSoon(shifts, now), [now, shifts]);
  const outstanding = useMemo(() => outstandingAtClose(checklist), [checklist]);
  const onNow = roster.filter((shift) => shiftState(shift, now) === 'on');

  useEffect(() => {
    if (isDemo) {
      setChecklist(DEMO_CHECKLIST);
      setShifts(DEMO_SHIFTS);
      return undefined;
    }
    if (!supabase || !user) return undefined;
    const database = supabase;
    let active = true;
    const load = async () => {
      try {
        const [rosterRows, opening, closing, daily] = await Promise.all([
          fetchShiftRoster(database, location.id, serviceDate),
          fetchChecklist(database, location.id, serviceDate, 'opening'),
          fetchChecklist(database, location.id, serviceDate, 'closing'),
          fetchChecklist(database, location.id, serviceDate, 'daily'),
        ]);
        if (!active) return;
        setShifts(rosterRows.map(shiftFromRow));
        setChecklist([...opening, ...closing, ...daily].map((item) =>
          checklistFromRow(item, user.id, portal.profile.fullName)));
      } catch {
        // Keep the last roster and retry on the heartbeat.
      }
    };
    void load();
    const heartbeat = setInterval(() => void load(), 60_000);
    return () => {
      active = false;
      clearInterval(heartbeat);
    };
  }, [isDemo, location.id, portal.profile.fullName, serviceDate, user]);

  function tick(id: string) {
    const previous = checklist.find((item) => item.id === id);
    if (!previous) return;
    const crewMember = isDemo ? DEMO_CREW_MEMBER : portal.profile.fullName || 'Team member';
    setChecklist((current) => toggleItem(current, id, crewMember, new Date().toISOString()));
    if (isDemo || !supabase || !tenant || !user) return;
    const request = previous.completedAt === null
      ? supabase.from('crew_task_completions').insert({
        brand_id: tenant.brand_id,
        location_id: location.id,
        task_id: id,
        service_date: serviceDate,
        completed_by: user.id,
      })
      : supabase
        .from('crew_task_completions')
        .delete()
        .eq('task_id', id)
        .eq('location_id', location.id)
        .eq('service_date', serviceDate);
    void request.then((result) => {
      if (result.error) {
        setChecklist((current) => current.map((item) => item.id === id ? previous : item));
      }
    });
  }

  return (
    <CollapsingScreen
      title="Crew"
      eyebrow={`${onNow.length} on the floor · ${outstanding.length} left to do`}
    >
      {soon.length > 0 ? (
        <View style={styles.notice}>
          <Text style={styles.noticeLabel}>Leaving soon</Text>
          <Text style={styles.noticeBody}>
            {soon.map((shift) => `${shift.staffName} (${minutesRemaining(shift, now)} min)`).join(' · ')}
          </Text>
        </View>
      ) : null}

      <SectionTitle>On the floor</SectionTitle>
      {roster.map((shift) => {
        const state = shiftState(shift, now);
        return (
          <Card key={shift.id} style={styles.shift}>
            <View style={styles.shiftCopy}>
              <Text style={[styles.shiftName, state === 'ended' && styles.faded]}>
                {shift.staffName}
              </Text>
              <Body muted>{shift.role} · {clockRange(shift.startsAt, shift.endsAt)}</Body>
            </View>
            <View style={[styles.statePill, stateTone[state]]}>
              <Text style={[styles.stateText, { color: stateText[state] }]}>
                {STATE_LABEL[state]}
              </Text>
            </View>
          </Card>
        );
      })}

      <Checklist title="Opening" recurrence="opening" items={checklist} onToggle={tick} />
      <Checklist title="Closing" recurrence="closing" items={checklist} onToggle={tick} />
      <Checklist title="Through the day" recurrence="daily" items={checklist} onToggle={tick} />
    </CollapsingScreen>
  );
}

function shiftFromRow(row: RosterEntry): Shift {
  return {
    id: row.id,
    staffName: row.staffName,
    role: row.staffRole.replaceAll('_', ' '),
    startsAt: row.starts_at,
    endsAt: row.ends_at,
  };
}

function checklistFromRow(
  row: DataChecklistItem,
  userId: string,
  userName: string,
): ChecklistItem {
  return {
    id: row.id,
    title: row.title,
    detail: row.detail,
    recurrence: row.recurrence === 'weekly' ? 'daily' : row.recurrence,
    sortOrder: row.sort_order,
    completedAt: row.completedAt,
    completedBy: row.completedBy
      ? row.completedBy === userId ? userName || 'You' : 'Crew member'
      : null,
  };
}

function Checklist({
  title, recurrence, items, onToggle,
}: {
  title: string;
  recurrence: ChecklistRecurrence;
  items: readonly ChecklistItem[];
  onToggle: (id: string) => void;
}) {
  const tokens = useBrandTokens();
  const styles = createStyles(tokens);
  const list = itemsFor(items, recurrence);
  const progress = progressOf(list);
  if (list.length === 0) return null;

  return (
    <>
      <SectionTitle>{title} · {progress.done}/{progress.total}</SectionTitle>
      {list.map((item) => {
        const done = item.completedAt !== null;
        return (
          <Pressable
            key={item.id}
            accessibilityRole="checkbox"
            accessibilityLabel={item.title}
            {...choiceState(done)}
            onPress={() => onToggle(item.id)}
            style={({ pressed }) => [styles.taskRow, pressed && styles.pressed]}
          >
            <Card style={styles.task}>
              <View style={[styles.box, done && styles.boxDone]}>
                {done ? <Text style={styles.tick}>✓</Text> : null}
              </View>
              <View style={styles.taskCopy}>
                <Text style={[styles.taskTitle, done && styles.taskTitleDone]}>{item.title}</Text>
                <Body muted>
                  {/* Attribution is the point of a checklist: "done" without a
                      name is a claim nobody owns. */}
                  {done && item.completedBy ? `${item.completedBy} · ${clockTime(item.completedAt!)}` : item.detail}
                </Body>
              </View>
            </Card>
          </Pressable>
        );
      })}
    </>
  );
}

function clockTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function clockRange(startsAt: string, endsAt: string): string {
  return `${clockTime(startsAt)} – ${clockTime(endsAt)}`;
}

const STATE_LABEL = { on: 'On', upcoming: 'Later', ended: 'Done' } as const;
const createStyles = (tokens: BrandTokens) => StyleSheet.create({
  notice: {
    backgroundColor: tokens.surface, borderRadius: tokens.radius.lg,
    padding: tokens.spacing.lg, gap: 4, marginBottom: tokens.spacing.lg,
  },
  noticeLabel: {
    color: tokens.warning, fontFamily: tokens.fontBody, fontSize: 13,
    letterSpacing: 1.2, textTransform: 'uppercase',
  },
  noticeBody: { color: tokens.textPrimary, fontFamily: tokens.fontBody, fontSize: 18 },
  shift: { flexDirection: 'row', alignItems: 'center', gap: tokens.spacing.lg, marginBottom: tokens.spacing.md },
  shiftCopy: { flex: 1, gap: 2 },
  shiftName: { color: tokens.textPrimary, fontFamily: tokens.fontDisplay, fontSize: 22 },
  faded: { color: tokens.textMuted },
  statePill: { paddingHorizontal: tokens.spacing.lg, paddingVertical: 8, borderRadius: tokens.radius.pill },
  stateText: { fontFamily: tokens.fontBody, fontSize: 14 },
  taskRow: { marginBottom: tokens.spacing.md },
  task: { flexDirection: 'row', alignItems: 'center', gap: tokens.spacing.lg, minHeight: 72 },
  box: {
    width: 32, height: 32, borderRadius: 8, borderWidth: 2,
    borderColor: tokens.textMuted, alignItems: 'center', justifyContent: 'center',
  },
  boxDone: { backgroundColor: tokens.success, borderColor: tokens.success },
  tick: { color: tokens.surfaceElevated, fontFamily: tokens.fontBody, fontSize: 18 },
  taskCopy: { flex: 1, gap: 2 },
  taskTitle: { color: tokens.textPrimary, fontFamily: tokens.fontBody, fontSize: 18 },
  taskTitleDone: { color: tokens.textMuted, textDecorationLine: 'line-through' },
  pressed: { opacity: 0.85 },
});
