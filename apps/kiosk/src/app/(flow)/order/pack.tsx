import { StyleSheet, Text, View } from 'react-native';

import {
  formatMoney, itemsInCategoryOf, packsInCategoryOf, sizePriceCents,
} from '@platform/domain';
import { useTokens } from '@platform/ui';

import { StepHeading } from '@/components/chrome/step-heading';
import { CircleTile } from '@/components/circle/circle-tile';
import { packSavingBps } from '@/features/pack-fill';
import { useKioskMenu } from '@/data/menu-store';
import { useBuilder } from '@/state/builder';
import { useFlow } from '@/state/flow';
import TENANT from '@/tenant/brand.json';

/**
 * "How many would you like?"
 *
 * The saving badge is DERIVED, never stored -- `packSavingBps` mirrors
 * `app.pack_saving_bps` (0029) so a price change cannot leave a stale discount
 * claim on the shelf, and a pack priced above its singles advertises nothing
 * rather than a negative saving.
 */
export default function PackStep() {
  const tokens = useTokens();
  const { selected, goNext } = useFlow();
  const builder = useBuilder();
  const { menu } = useKioskMenu();

  const categoryTitle = selected?.target.kind === 'category' ? selected.target.categoryId : '';
  const packs = packsInCategoryOf(menu, categoryTitle);
  const singles = itemsInCategoryOf(menu, categoryTitle);

  if (packs.length === 0) {
    return (
      <View style={styles.empty}>
        <StepHeading
          title="Nothing to build here yet"
          hint="This shop has not set up any boxes."
        />
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <StepHeading title="How many would you like?" />
      <View style={styles.grid}>
        {packs.map((pack, index) => {
          const single = singles.find((item) => item.id === pack.singleItemId);
          const singlePrice = single?.sizes[0] ? sizePriceCents(single.sizes[0]) : 0;
          const packPrice = pack.sizes[0] ? sizePriceCents(pack.sizes[0]) : 0;
          const savingBps = packSavingBps(singlePrice, packPrice, pack.packSize ?? 0);
          return (
            <View key={pack.id} style={styles.cell}>
              <CircleTile
                index={index}
                label={pack.name}
                caption={formatMoney(packPrice)}
                variant="kioskNode"
                request={{ imageSlug: pack.id, monogram: TENANT.business?.monogram, label: pack.name }}
                onPress={() => { builder.choose(pack); goNext(); }}
              />
              {savingBps > 0 ? (
                <Text style={[styles.saving, { color: tokens.accent, fontFamily: tokens.fontBody, fontSize: tokens.type.md }]}>
                  {`Save ${Math.round(savingBps / 100)}%`}
                </Text>
              ) : null}
            </View>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: 32 },
  empty: { flex: 1, justifyContent: 'center' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 48, justifyContent: 'center', paddingTop: 12 },
  cell: { alignItems: 'center', gap: 6 },
  saving: { fontWeight: '700', letterSpacing: 0.6 },
});
