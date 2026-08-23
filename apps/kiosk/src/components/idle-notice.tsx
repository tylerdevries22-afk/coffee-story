import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useTokens } from '@platform/ui';

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
  const { idle, secondsLeft, touch, reset } = useKioskSession();
  if (idle !== 'warning') return null;

  return (
    <View style={[styles.scrim, { backgroundColor: `${tokens.textPrimary}D9` }]}>
      <View style={[styles.card, { backgroundColor: tokens.surfaceElevated, borderRadius: tokens.radius.lg }]}>
        <Text style={[styles.title, { color: tokens.textPrimary, fontFamily: tokens.fontDisplay }]}>
          Still ordering?
        </Text>
        <Text style={[styles.detail, { color: tokens.textMuted }]}>
          Starting over in {secondsLeft}s
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Keep ordering"
          onPress={touch}
          style={[styles.keep, { backgroundColor: tokens.primary }]}
        >
          <Text style={[styles.keepLabel, { color: tokens.surfaceElevated }]}>Keep ordering</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Start over now"
          onPress={reset}
          style={styles.startOver}
        >
          <Text style={[styles.startOverLabel, { color: tokens.textMuted }]}>Start over</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  scrim: { position: 'absolute', inset: 0, alignItems: 'center', justifyContent: 'center' },
  card: { width: 560, padding: 44, gap: 16, alignItems: 'center' },
  title: { fontSize: 44 },
  detail: { fontSize: 24 },
  keep: { minHeight: 88, borderRadius: 999, paddingHorizontal: 56, justifyContent: 'center', marginTop: 12 },
  keepLabel: { fontSize: 26, fontWeight: '700' },
  startOver: { minHeight: 60, justifyContent: 'center' },
  startOverLabel: { fontSize: 20, fontWeight: '600' },
});
