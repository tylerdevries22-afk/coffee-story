import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useCopy, useTokens } from '@platform/ui';
import type { KioskUtility } from '@platform/domain';

import * as haptics from '@/lib/haptics';

/**
 * The furniture every step carries: who this shop is, a way out, a way back,
 * and the handful of things a guest may need at any point.
 *
 * Persistent on purpose. A standing guest with a queue behind them should never
 * have to wonder where "start again" lives, and hunting for it is exactly when
 * they give up and walk to the counter.
 */
const UTILITY_LABEL: Record<KioskUtility, string> = {
  rewards: 'Rewards',
  giftBalance: 'Check gift card',
  allergens: 'Allergy & nutrition',
};

export function KioskChrome({
  utilities,
  canGoBack,
  onBack,
  onStartOver,
  onUtility,
}: {
  utilities: readonly KioskUtility[];
  canGoBack: boolean;
  onBack: () => void;
  onStartOver: () => void;
  onUtility: (utility: KioskUtility) => void;
}) {
  const tokens = useTokens();
  const copy = useCopy();

  return (
    <View style={styles.bar}>
      <View style={styles.left}>
        <Text
          numberOfLines={1}
          style={[styles.brand, { color: tokens.textPrimary, fontFamily: tokens.fontDisplay, fontSize: tokens.type.xxl }]}
        >
          {copy('appName')}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Start over"
          onPress={() => { haptics.tapped(); onStartOver(); }}
          style={[styles.pill, { borderColor: tokens.textMuted, borderRadius: tokens.radius.pill }]}
        >
          <Text style={[styles.pillLabel, { color: tokens.textPrimary, fontSize: tokens.type.md }]}>
            Start over
          </Text>
        </Pressable>
        {canGoBack ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Go back"
            onPress={() => { haptics.tapped(); onBack(); }}
            style={[styles.pill, { borderColor: tokens.textMuted, borderRadius: tokens.radius.pill }]}
          >
            <Text style={[styles.pillLabel, { color: tokens.textPrimary, fontSize: tokens.type.md }]}>
              Back
            </Text>
          </Pressable>
        ) : null}
      </View>

      <View style={styles.right}>
        {utilities.map((utility) => (
          <Pressable
            key={utility}
            accessibilityRole="button"
            accessibilityLabel={UTILITY_LABEL[utility]}
            onPress={() => { haptics.tapped(); onUtility(utility); }}
            style={[styles.pill, { borderColor: tokens.textMuted, borderRadius: tokens.radius.pill }]}
          >
            <Text style={[styles.pillLabel, { color: tokens.textPrimary, fontSize: tokens.type.md }]}>
              {UTILITY_LABEL[utility]}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 32, paddingTop: 24, gap: 16 },
  left: { flexDirection: 'row', alignItems: 'center', gap: 16, flexShrink: 1 },
  right: { flexDirection: 'row', alignItems: 'center', gap: 12, flexShrink: 0 },
  brand: { marginRight: 8 },
  // 60pt minimum: a standing guest taps less precisely than a seated one
  // holding a phone (docs/FIVE-SURFACES.md).
  pill: { minHeight: 60, paddingHorizontal: 24, justifyContent: 'center', borderWidth: 2 },
  pillLabel: { fontWeight: '600' },
});
