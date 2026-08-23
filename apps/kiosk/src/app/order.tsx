import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import {
  buildOrderLine, formatMoney, orderSubtotalCents, orderTotals, sizeLabelFor, sizePriceCents,
} from '@platform/domain';
import type { MenuCategoryId } from '@platform/domain';
import { useTokens } from '@platform/ui';

import { MENU_CATEGORY_META, MENU_ITEMS } from '@/data/catalog';
import { useKioskSession } from '@/state/session';
import { IdleNotice } from '@/components/idle-notice';
import { BagRail } from '@/components/bag-rail';

/**
 * The ordering surface.
 *
 * One screen, not a stack: a standing guest with a queue behind them should
 * never wonder where they are, so the menu and the bag are both permanently
 * visible and the only navigation is which category is showing.
 */
export default function OrderScreen() {
  const tokens = useTokens();
  const router = useRouter();
  const { cart, addLine, touch } = useKioskSession();
  const [category, setCategory] = useState<MenuCategoryId>('signature');

  const items = useMemo(
    () => MENU_ITEMS.filter((item) => item.category === category),
    [category],
  );
  const totals = useMemo(
    () => orderTotals({ subtotalCents: orderSubtotalCents(cart) }),
    [cart],
  );

  return (
    <View style={[styles.root, { backgroundColor: tokens.surface }]} onTouchStart={touch}>
      <View style={styles.menuPane}>
        <View style={styles.header}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Start over"
            onPress={() => router.replace('/')}
            style={[styles.back, { borderColor: tokens.textMuted }]}
          >
            <Text style={[styles.backLabel, { color: tokens.textPrimary }]}>Start over</Text>
          </Pressable>
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.strip}>
          {MENU_CATEGORY_META.map((meta) => {
            const active = meta.id === category;
            return (
              <Pressable
                key={meta.id}
                accessibilityRole="tab"
                accessibilityState={{ selected: active }}
                aria-selected={active}
                onPress={() => { touch(); setCategory(meta.id); }}
                style={[
                  styles.chip,
                  { borderColor: active ? tokens.primary : tokens.textMuted },
                  active && { backgroundColor: tokens.primary },
                ]}
              >
                <Text style={[styles.chipLabel, { color: active ? tokens.surfaceElevated : tokens.textPrimary }]}>
                  {meta.title}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>

        <ScrollView contentContainerStyle={styles.grid}>
          {items.map((item) => {
            const size = item.sizes[0];
            const soldOut = item.soldOutToday === true;
            return (
              <Pressable
                key={item.id}
                accessibilityRole="button"
                accessibilityLabel={`${item.name}, ${formatMoney(sizePriceCents(size))}`}
                accessibilityState={{ disabled: soldOut }}
                aria-disabled={soldOut}
                disabled={soldOut}
                onPress={() => addLine(buildOrderLine({
                  itemId: item.id,
                  name: item.name,
                  sizeSlug: size.slug,
                  sizeLabel: sizeLabelFor(size.slug),
                  basePriceCents: sizePriceCents(size),
                  groups: [],
                  selection: {},
                  quantity: 1,
                }))}
                style={[
                  styles.tile,
                  { backgroundColor: tokens.surfaceElevated, borderRadius: tokens.radius.lg },
                  soldOut && styles.tileSoldOut,
                ]}
              >
                <Text style={[styles.tileName, { color: tokens.textPrimary, fontFamily: tokens.fontDisplay }]}>
                  {item.name}
                </Text>
                <Text style={[styles.tilePrice, { color: soldOut ? tokens.textMuted : tokens.accent }]}>
                  {soldOut ? "Sold out today" : formatMoney(sizePriceCents(size))}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      <BagRail totals={totals} />
      <IdleNotice />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, flexDirection: 'row' },
  menuPane: { flex: 1, paddingLeft: 32, paddingTop: 24 },
  header: { flexDirection: 'row', paddingBottom: 16 },
  // 60pt minimum everywhere: a standing guest taps less precisely than a
  // seated one holding a phone.
  back: { minHeight: 60, paddingHorizontal: 28, justifyContent: 'center', borderWidth: 2, borderRadius: 999 },
  backLabel: { fontSize: 20, fontWeight: '600' },
  strip: { gap: 12, paddingRight: 32, paddingBottom: 20 },
  chip: { minHeight: 60, paddingHorizontal: 26, justifyContent: 'center', borderWidth: 2, borderRadius: 999 },
  chipLabel: { fontSize: 20, fontWeight: '600' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 16, paddingRight: 32, paddingBottom: 40 },
  tile: { width: 260, minHeight: 150, padding: 22, justifyContent: 'space-between' },
  tileSoldOut: { opacity: 0.45 },
  tileName: { fontSize: 26 },
  tilePrice: { fontSize: 24, fontWeight: '700' },
});
