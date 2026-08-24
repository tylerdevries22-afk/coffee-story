import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useCopy, useTokens } from '@platform/ui';
import type { KioskUtility } from '@platform/domain';

import * as haptics from '@/lib/haptics';
import { utilityContentFor } from '@/features/utility-content';

/**
 * The furniture every step carries: who this shop is, a way out, a way back,
 * and the handful of things a guest may need at any point.
 *
 * Persistent on purpose. A standing guest with a queue behind them should never
 * have to wonder where "start again" lives, and hunting for it is exactly when
 * they give up and walk to the counter.
 */
export function KioskChrome({
  utilities,
  canStartOver,
  canGoBack,
  onBack,
  onStartOver,
  onUtility,
  cart,
  onCart,
}: {
  utilities: readonly KioskUtility[];
  canStartOver: boolean;
  canGoBack: boolean;
  onBack: () => void;
  onStartOver: () => void;
  onUtility: (utility: KioskUtility) => void;
  cart?: { count: number; amount: string; accessibilityLabel: string };
  onCart?: () => void;
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
        {canStartOver ? (
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
        ) : null}
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
            accessibilityLabel={utilityContentFor(utility).label}
            onPress={() => { haptics.tapped(); onUtility(utility); }}
            style={[styles.pill, { borderColor: tokens.textMuted, borderRadius: tokens.radius.pill }]}
          >
            <Text style={[styles.pillLabel, { color: tokens.textPrimary, fontSize: tokens.type.md }]}>
              {utilityContentFor(utility).label}
            </Text>
          </Pressable>
        ))}
        {cart && onCart ? (
          <Pressable
            testID="kiosk-cart-button"
            accessibilityRole="button"
            accessibilityLabel={cart.accessibilityLabel}
            onPress={() => { haptics.tapped(); onCart(); }}
            style={[
              styles.cart,
              {
                backgroundColor: tokens.textPrimary,
                borderRadius: tokens.radius.pill,
                shadowColor: tokens.textPrimary,
                shadowOpacity: tokens.elevation.raised,
              },
            ]}
          >
            <Text style={[styles.cartLabel, { color: tokens.surfaceElevated, fontSize: tokens.type.md }]}>Cart</Text>
            <View style={[styles.count, { backgroundColor: tokens.surfaceElevated, borderRadius: tokens.radius.pill }]}>
              <Text style={[styles.countLabel, { color: tokens.textPrimary, fontSize: tokens.type.sm }]}>{cart.count}</Text>
            </View>
            <Text style={[styles.cartAmount, { color: tokens.surfaceElevated, fontSize: tokens.type.md }]}>{cart.amount}</Text>
          </Pressable>
        ) : null}
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
  cart: {
    minHeight: 60, paddingHorizontal: 22, flexDirection: 'row', alignItems: 'center', gap: 10,
    shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 4,
  },
  cartLabel: { fontWeight: '700' },
  cartAmount: { fontWeight: '600' },
  count: { minWidth: 28, height: 28, paddingHorizontal: 8, alignItems: 'center', justifyContent: 'center' },
  countLabel: { fontWeight: '800' },
});
