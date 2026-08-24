import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useTokens } from '@platform/ui';

import { secondsUntilReset } from '@/features/idle';

import { useKioskSession } from '@/state/session';

/**
 * "Still there?"
 *
 * A kiosk that resets while someone is deciding between two drinks is worse
 * than one that never resets, so the timeout asks first. It covers the screen
 * on purpose: a guest who has stepped back needs to see it from where they are
 * standing, not find a toast in a corner.
 */
export function IdleNotice() {
  const tokens = useTokens();
  const { idle, touch, reset, idleMsNow } = useKioskSession();
  const warning = idle === 'warning';
  const [secondsLeft, setSecondsLeft] = useState(() => secondsUntilReset(idleMsNow()));

  /**
   * The countdown is local state here rather than in the session, and it only
   * exists while the notice is on screen.
   *
   * Keeping the seconds in the session meant rebuilding its context value once
   * a second for the whole life of a session -- every consumer re-rendering at
   * 1Hz to serve a number that is visible for thirty seconds of it. This
   * component is unmounted the other 99% of the time.
   */
  useEffect(() => {
    if (!warning) return;
    setSecondsLeft(secondsUntilReset(idleMsNow()));
    const id = setInterval(() => setSecondsLeft(secondsUntilReset(idleMsNow())), 1_000);
    return () => clearInterval(id);
  }, [warning, idleMsNow]);

  if (!warning) return null;

  return (
    <View style={[styles.scrim, { backgroundColor: `${tokens.textPrimary}D9` }]}>
      <View style={[styles.card, { backgroundColor: tokens.surfaceElevated, borderRadius: tokens.radius.lg, padding: tokens.spacing.xxl, gap: tokens.spacing.lg }]}>
        <Text style={[styles.title, { color: tokens.textPrimary, fontFamily: tokens.fontDisplay, fontSize: tokens.type.display }]}>
          Still ordering?
        </Text>
        <Text style={[styles.detail, { color: tokens.textMuted, fontFamily: tokens.fontBody, fontSize: tokens.type.xl }]}>
          Starting over in {secondsLeft}s
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Keep ordering"
          onPress={touch}
          style={[styles.keep, { backgroundColor: tokens.primary, borderRadius: tokens.radius.pill, paddingHorizontal: tokens.spacing.xxl }]}
        >
          <Text style={[styles.keepLabel, { color: tokens.surfaceElevated, fontFamily: tokens.fontBody, fontSize: tokens.type.xl }]}>Keep ordering</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Start over now"
          onPress={reset}
          style={styles.startOver}
        >
          <Text style={[styles.startOverLabel, { color: tokens.textMuted, fontFamily: tokens.fontBody, fontSize: tokens.type.lg }]}>Start over</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  scrim: { position: 'absolute', inset: 0, alignItems: 'center', justifyContent: 'center' },
  card: { width: 560, alignItems: 'center' },
  title: {},
  detail: {},
  keep: { minHeight: 88, justifyContent: 'center', marginTop: 12 },
  keepLabel: { fontWeight: '700' },
  startOver: { minHeight: 60, justifyContent: 'center' },
  startOverLabel: { fontWeight: '600' },
});
