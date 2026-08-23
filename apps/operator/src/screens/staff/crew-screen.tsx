import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { CollapsingScreen } from '@/components/collapsing-screen';
import { Body, Card, SectionTitle } from '@/components/ui';
import { DEMO_CHECKLIST, DEMO_CREW_MEMBER, DEMO_SHIFTS } from '@/data/crew-demo';
import {
  itemsFor, outstandingAtClose, progressOf, toggleItem, type ChecklistItem, type ChecklistRecurrence,
} from '@/features/crew/checklist';
import { leavingSoon, minutesRemaining, shiftState, sortRoster } from '@/features/crew/shift';
import { choiceState } from '@/lib/a11y-state';
import { colors, fonts, radius, spacing } from '@/theme/tokens';

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
  const [checklist, setChecklist] = useState<readonly ChecklistItem[]>(DEMO_CHECKLIST);
  // One clock for the whole render, so the roster and the "leaving soon" cue
  // can never disagree about what time it is.
  const now = useMemo(() => new Date(), []);

  const roster = useMemo(() => sortRoster(DEMO_SHIFTS, now), [now]);
  const soon = useMemo(() => leavingSoon(DEMO_SHIFTS, now), [now]);
  const outstanding = useMemo(() => outstandingAtClose(checklist), [checklist]);
  const onNow = roster.filter((shift) => shiftState(shift, now) === 'on');

  function tick(id: string) {
    setChecklist((current) => toggleItem(current, id, DEMO_CREW_MEMBER, new Date().toISOString()));
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
            <View style={[styles.statePill, STATE_TONE[state]]}>
              <Text style={[styles.stateText, { color: STATE_TEXT[state] }]}>
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

function Checklist({
  title, recurrence, items, onToggle,
}: {
  title: string;
  recurrence: ChecklistRecurrence;
  items: readonly ChecklistItem[];
  onToggle: (id: string) => void;
}) {
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
const STATE_TONE = {
  on: { backgroundColor: colors.successTint },
  upcoming: { backgroundColor: colors.gold50 },
  ended: { backgroundColor: colors.ink200 },
} as const;
const STATE_TEXT = { on: colors.success, upcoming: colors.warning, ended: colors.ink500 } as const;

const styles = StyleSheet.create({
  notice: {
    backgroundColor: colors.gold50, borderRadius: radius.md,
    padding: spacing.md, gap: 4, marginBottom: spacing.md,
  },
  noticeLabel: {
    color: colors.warning, fontFamily: fonts.sansBold, fontSize: 13,
    letterSpacing: 1.2, textTransform: 'uppercase',
  },
  noticeBody: { color: colors.ink900, fontFamily: fonts.sansBold, fontSize: 18 },
  shift: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.sm },
  shiftCopy: { flex: 1, gap: 2 },
  shiftName: { color: colors.ink900, fontFamily: fonts.display, fontSize: 22 },
  faded: { color: colors.ink500 },
  statePill: { paddingHorizontal: spacing.md, paddingVertical: 8, borderRadius: radius.pill },
  stateText: { fontFamily: fonts.sansBold, fontSize: 14 },
  taskRow: { marginBottom: spacing.sm },
  task: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 72 },
  box: {
    width: 32, height: 32, borderRadius: 8, borderWidth: 2,
    borderColor: colors.ink300, alignItems: 'center', justifyContent: 'center',
  },
  boxDone: { backgroundColor: colors.success, borderColor: colors.success },
  tick: { color: colors.white, fontFamily: fonts.sansBold, fontSize: 18 },
  taskCopy: { flex: 1, gap: 2 },
  taskTitle: { color: colors.ink900, fontFamily: fonts.sansBold, fontSize: 18 },
  taskTitleDone: { color: colors.ink500, textDecorationLine: 'line-through' },
  pressed: { opacity: 0.85 },
});
