import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { formatMoney, orderSubtotalCents, orderTotals } from '@platform/domain';
import { useTokens } from '@platform/ui';

import { useKioskSession } from '@/state/session';

/**
 * Tender.
 *
 * The card reader is the whole interaction: a guest taps, the reader answers,
 * and this screen exists to say which of those is happening. Nothing here is
 * cancellable mid-read, because a half-authorised payment with a cancel button
 * beside it is how a shop ends up refunding by hand.
 *
 * Card capture is not wired: Square's Reader SDK needs a dev client, not Expo
 * Go, and the decision about which build this ships as is open (see the plan's
 * open items). The state machine below is real; only `authorize` is simulated,
 * and it is the single seam that changes when the reader lands.
 */
export default function TenderScreen() {
  const tokens = useTokens();
  const router = useRouter();
  const { cart, posture, touch } = useKioskSession();
  const [phase, setPhase] = useState<'ready' | 'reading' | 'failed'>('ready');

  const totals = useMemo(
    () => orderTotals({ subtotalCents: orderSubtotalCents(cart) }),
    [cart],
  );

  async function authorize() {
    setPhase('reading');
    // The seam. A real reader replaces this and nothing else on this screen.
    await new Promise((resolve) => setTimeout(resolve, 1_200));
    router.replace('/receipt');
  }

  return (
    <View style={[styles.root, { backgroundColor: tokens.surface }]} onTouchStart={touch}>
      <Text style={[styles.total, { color: tokens.textPrimary, fontFamily: tokens.fontDisplay }]}>
        {formatMoney(totals.totalCents)}
      </Text>

      {phase === 'reading' ? (
        <View style={styles.reading}>
          <ActivityIndicator size="large" color={tokens.accent} />
          <Text style={[styles.instruction, { color: tokens.textMuted }]}>Reading your card…</Text>
        </View>
      ) : (
        <>
          <Text style={[styles.instruction, { color: tokens.textMuted }]}>
            Tap or insert your card on the reader
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Pay ${formatMoney(totals.totalCents)} by card`}
            onPress={() => void authorize()}
            style={[styles.action, { backgroundColor: tokens.primary }]}
          >
            <Text style={[styles.actionLabel, { color: tokens.surfaceElevated }]}>Card</Text>
          </Pressable>
          {posture.allowsCashTender ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Take cash"
              onPress={() => router.replace('/receipt')}
              style={[styles.secondary, { borderColor: tokens.primary }]}
            >
              <Text style={[styles.secondaryLabel, { color: tokens.textPrimary }]}>Cash</Text>
            </Pressable>
          ) : null}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back to the menu"
            onPress={() => router.back()}
            style={styles.back}
          >
            <Text style={[styles.backLabel, { color: tokens.textMuted }]}>Back to menu</Text>
          </Pressable>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 20 },
  total: { fontSize: 108 },
  instruction: { fontSize: 28 },
  reading: { alignItems: 'center', gap: 24, minHeight: 260, justifyContent: 'center' },
  action: {
    minHeight: 96, minWidth: 420, borderRadius: 999,
    alignItems: 'center', justifyContent: 'center', marginTop: 16,
  },
  actionLabel: { fontSize: 30, fontWeight: '700' },
  secondary: {
    minHeight: 84, minWidth: 420, borderRadius: 999, borderWidth: 2,
    alignItems: 'center', justifyContent: 'center',
  },
  secondaryLabel: { fontSize: 26, fontWeight: '700' },
  back: { minHeight: 60, justifyContent: 'center', marginTop: 12 },
  backLabel: { fontSize: 20, fontWeight: '600' },
});
