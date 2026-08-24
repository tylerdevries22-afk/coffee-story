import { StyleSheet, View } from 'react-native';

import type { KioskEntryNode } from '@platform/domain';

import { StepHeading } from '@/components/chrome/step-heading';
import { Constellation } from '@/components/circle/constellation';
import { useFlow } from '@/state/flow';
import TENANT from '@/tenant/brand.json';

/**
 * The first screen, and the one that is entirely the tenant's.
 *
 * Nothing here knows what a coffee shop sells. It renders whatever
 * `brand_config.kiosk.entry.nodes` says, and when a tenant has configured
 * nothing the resolver has already derived a screen from their menu -- so a
 * franchise onboarded this morning opens on something a guest can press.
 */
export default function EntryStep() {
  const { flow, learn, goTo, goNext } = useFlow();

  function select(node: KioskEntryNode) {
    switch (node.target.kind) {
      case 'group':
        learn({ inGroup: true });
        goTo('node');
        return;
      case 'category':
      case 'item':
        learn({ inGroup: false });
        goNext();
        return;
      case 'utility':
        return;
    }
  }

  return (
    <View style={styles.root}>
      <StepHeading title={flow.entry.prompt} />
      <Constellation
        nodes={flow.entry.nodes}
        monogram={TENANT.business?.monogram}
        onSelect={select}
      />
    </View>
  );
}

const styles = StyleSheet.create({ root: { flex: 1, paddingHorizontal: 32, paddingBottom: 24 } });
