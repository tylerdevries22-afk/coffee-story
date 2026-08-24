import { ScrollView, StyleSheet, View } from 'react-native';

import { formatMoney, itemNeedsConfiguration, itemsForTarget, sizePriceCents } from '@platform/domain';
import { useTokens } from '@platform/ui';

import { FlowRecovery } from '@/components/chrome/flow-recovery';
import { StepHeading } from '@/components/chrome/step-heading';
import { CircleTile } from '@/components/circle/circle-tile';
import { useKioskMenu } from '@/data/menu-store';
import { useBuilder } from '@/state/builder';
import { useFlow } from '@/state/flow';
import TENANT from '@/tenant/brand.json';

/**
 * What is in the category the guest tapped.
 *
 * An 86'd item is shown and not orderable rather than hidden: a guest who came
 * for it needs to learn it is gone, and a menu that silently shrinks looks like
 * a menu that never had it.
 */
export default function ItemStep() {
  const tokens = useTokens();
  const { selected, goNext, goTo } = useFlow();
  const builder = useBuilder();
  const { menu } = useKioskMenu();

  // An item-family flow must never sell a container without collecting its
  // exact fill. Misconfigured pack targets fail closed into recovery.
  const items = itemsForTarget(menu, selected?.target).filter((item) => item.packSize === undefined);

  if (items.length === 0) return <FlowRecovery onRecover={() => goTo('entry')} />;

  return (
    <View style={styles.root}>
      <StepHeading title={selected?.label ?? 'Choose a drink'} />
      <ScrollView contentContainerStyle={styles.grid}>
        {items.map((item, index) => {
          const soldOut = item.soldOutToday;
          const from = item.sizes[0];
          return (
            <CircleTile
              key={item.id}
              index={index}
              label={item.name}
              caption={soldOut ? 'Sold out today' : from ? formatMoney(sizePriceCents(from)) : undefined}
              variant="kioskChoice"
              disabled={soldOut}
              request={{
                imageSlug: item.id,
                imageUrl: item.imageUrl,
                monogram: TENANT.business?.monogram,
                label: item.name,
              }}
              onPress={() => {
                builder.choose(item);
                // Whether an options screen exists at all is a property of the
                // item -- a latte has size, milk and ice; a mochi donut has
                // none -- so it is carried INTO the advance rather than set
                // beside it, or the step is decided from stale facts.
                goNext({ hasOptions: itemNeedsConfiguration(item) });
              }}
            />
          );
        })}
      </ScrollView>
      <View style={[styles.rule, { backgroundColor: tokens.accent }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: 32 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 40, paddingBottom: 48, justifyContent: 'center' },
  rule: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 4, opacity: 0.35 },
});
