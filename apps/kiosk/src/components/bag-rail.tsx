import { useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { formatMoney, orderLineTotalCents } from '@platform/domain';
import type { OrderTotals } from '@platform/domain';
import { useTokens } from '@platform/ui';

import { useKioskSession } from '@/state/session';

/**
 * The bag, permanently on screen.
 *
 * The phone puts the bag on its own screen because it has no room for two
 * things at once. Landscape does, and a guest at a counter needs to watch the
 * total accrue without losing the menu -- so the rail is the single biggest
 * difference between this surface and the customer app's.
 */
export function BagRail({ totals }: { totals: OrderTotals }) {
  const tokens = useTokens();
  const router = useRouter();
  const { cart, changeQuantity, removeLine } = useKioskSession();
  const empty = cart.lines.length === 0;

  return (
    <View style={[styles.rail, { backgroundColor: tokens.surfaceElevated }]}>
      <Text style={[styles.title, { color: tokens.textPrimary, fontFamily: tokens.fontDisplay }]}>
        Your order
      </Text>

      {empty ? (
        <Text style={[styles.empty, { color: tokens.textMuted }]}>
          Tap anything on the menu to start.
        </Text>
      ) : (
        <ScrollView contentContainerStyle={styles.lines}>
          {cart.lines.map((line) => (
            <View key={line.id} style={styles.line}>
              <View style={styles.lineCopy}>
                <Text style={[styles.lineName, { color: tokens.textPrimary }]} numberOfLines={2}>
                  {line.name}
                </Text>
                <Text style={[styles.lineMeta, { color: tokens.textMuted }]}>{line.optionSummary || line.sizeLabel}</Text>
              </View>
              <View style={styles.stepper}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={line.quantity === 1 ? `Remove ${line.name}` : `One fewer ${line.name}`}
                  onPress={() => (line.quantity === 1 ? removeLine(line.id) : changeQuantity(line.id, -1))}
                  style={[styles.step, { borderColor: tokens.textMuted }]}
                >
                  {/* '×' rather than a bin emoji: the emoji rendered as tofu
                      on web, and a kiosk cannot afford a control nobody
                      recognises. */}
                  <Text style={[styles.stepGlyph, { color: tokens.textPrimary }]}>
                    {line.quantity === 1 ? '×' : '−'}
                  </Text>
                </Pressable>
                <Text style={[styles.qty, { color: tokens.textPrimary }]}>{line.quantity}</Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`One more ${line.name}`}
                  onPress={() => changeQuantity(line.id, 1)}
                  style={[styles.step, { borderColor: tokens.textMuted }]}
                >
                  <Text style={[styles.stepGlyph, { color: tokens.textPrimary }]}>+</Text>
                </Pressable>
              </View>
              <Text style={[styles.linePrice, { color: tokens.textPrimary }]}>
                {formatMoney(orderLineTotalCents(line))}
              </Text>
            </View>
          ))}
        </ScrollView>
      )}

      <View style={[styles.foot, { borderTopColor: tokens.surface }]}>
        {empty ? null : totals.taxRows.map((row) => (
          <Row key={row.id} label={row.label} value={formatMoney(row.amountCents)} muted />
        ))}
        {/* Money rides the action, the way docs/DESIGN.md specifies for every
            surface: a guest sees the cost where their thumb already is. */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Pay ${formatMoney(totals.totalCents)}`}
          accessibilityState={{ disabled: empty }}
          aria-disabled={empty}
          disabled={empty}
          onPress={() => router.push('/tender')}
          style={[
            styles.pay,
            { backgroundColor: empty ? tokens.textMuted : tokens.primary },
          ]}
        >
          <Text style={[styles.payLabel, { color: tokens.surfaceElevated }]}>Pay</Text>
          <Text style={[styles.payTotal, { color: tokens.surfaceElevated }]}>
            {formatMoney(totals.totalCents)}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

function Row({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  const tokens = useTokens();
  return (
    <View style={styles.row}>
      <Text style={[styles.rowLabel, { color: muted ? tokens.textMuted : tokens.textPrimary }]}>{label}</Text>
      <Text style={[styles.rowValue, { color: muted ? tokens.textMuted : tokens.textPrimary }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  rail: { width: 460, padding: 28, gap: 18 },
  title: { fontSize: 34 },
  empty: { fontSize: 20, lineHeight: 28 },
  lines: { gap: 20, paddingBottom: 12 },
  line: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  lineCopy: { flex: 1, gap: 2, minWidth: 108 },
  lineName: { fontSize: 20, fontWeight: '600' },
  lineMeta: { fontSize: 17 },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  step: { width: 60, height: 60, borderRadius: 30, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  stepGlyph: { fontSize: 26, fontWeight: '700' },
  qty: { fontSize: 22, fontWeight: '700', minWidth: 26, textAlign: 'center' },
  linePrice: { fontSize: 20, fontWeight: '700', minWidth: 64, textAlign: 'right' },
  foot: { marginTop: 'auto', borderTopWidth: 1, paddingTop: 18, gap: 10 },
  row: { flexDirection: 'row', justifyContent: 'space-between' },
  rowLabel: { fontSize: 17 },
  rowValue: { fontSize: 17 },
  pay: {
    minHeight: 92, borderRadius: 999, marginTop: 8,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 34,
  },
  payLabel: { fontSize: 28, fontWeight: '700' },
  payTotal: { fontSize: 28, fontWeight: '700' },
});
