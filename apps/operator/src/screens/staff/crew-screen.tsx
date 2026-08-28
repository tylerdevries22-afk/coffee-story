import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import {
  fetchShiftRoster, type RosterEntry,
} from '@platform/data';
import { isoDateInTimeZone } from '@platform/domain';

import { CollapsingScreen } from '@/components/collapsing-screen';
import { Body, Card, SectionTitle } from '@/components/ui';
import { DEMO_SHIFTS } from '@/data/crew-demo';
import {
  leavingSoon, minutesRemaining, shiftState, sortRoster, type Shift,
} from '@/features/crew/shift';
import { OperationQueue } from '@/features/operations/queue';
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
  const { isDemo, user } = useAuth();
  const { location, locationReady } = useOperator();
  const [shifts, setShifts] = useState<readonly Shift[]>(() => isDemo ? DEMO_SHIFTS : []);
  // One clock for the whole render, advanced once a minute so the roster,
  // leaving-soon cue, and location calendar day cannot drift apart.
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const heartbeat = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(heartbeat);
  }, []);

  const serviceDate = useMemo(
    () => isoDateInTimeZone(now, location.timezone),
    [location.timezone, now],
  );
  const roster = useMemo(() => sortRoster(shifts, now), [now, shifts]);
  const soon = useMemo(() => leavingSoon(shifts, now), [now, shifts]);
  const onNow = roster.filter((shift) => shiftState(shift, now) === 'on');

  useEffect(() => {
    if (isDemo) {
      setShifts(DEMO_SHIFTS);
      return undefined;
    }
    if (!supabase || !user || !locationReady) return undefined;
    const database = supabase;
    let active = true;
    const load = async () => {
      try {
        const rosterRows = await fetchShiftRoster(database, location.id, serviceDate);
        if (!active) return;
        setShifts(rosterRows.map(shiftFromRow));
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
  }, [isDemo, location.id, locationReady, serviceDate, user]);

  return (
    <CollapsingScreen
      title="Shift Tasks"
      eyebrow={`${onNow.length} on the floor · operational work for this location`}
    >
      {soon.length > 0 ? (
        <View style={styles.notice}>
          <Text style={styles.noticeLabel}>Leaving soon</Text>
          <Text style={styles.noticeBody}>
            {soon.map((shift) => `${shift.staffName} (${minutesRemaining(shift, now)} min)`).join(' · ')}
          </Text>
        </View>
      ) : null}

      <SectionTitle>Team on the floor</SectionTitle>
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

      <OperationQueue />
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
});
