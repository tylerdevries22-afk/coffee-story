import { StyleSheet, View } from 'react-native';

import type { KioskEntryNode } from '@platform/domain';

import { StepHeading } from '@/components/chrome/step-heading';
import { Constellation } from '@/components/circle/constellation';
import { useFlow } from '@/state/flow';
import TENANT from '@/tenant/brand.json';

/**
 * A bounded catalog-folder step. Nested groups reuse this screen, so the
 * kiosk follows the same published hierarchy as HQ without duplicating it.
 */
export default function NodeStep() {
  const { selected, group, select, goNext, openUtility } = useFlow();

  function choose(node: KioskEntryNode) {
    if (node.target.kind === 'utility') {
      openUtility(node.target.utility);
      return;
    }
    select(node);
    if (node.target.kind === 'group') {
      return;
    }
    goNext({ inGroup: true });
  }

  return (
    <View style={styles.root}>
      <StepHeading title={selected?.label ?? 'Which one?'} />
      <Constellation nodes={group} monogram={TENANT.business?.monogram} onSelect={choose} />
    </View>
  );
}

const styles = StyleSheet.create({ root: { flex: 1, paddingHorizontal: 32, paddingBottom: 24 } });
