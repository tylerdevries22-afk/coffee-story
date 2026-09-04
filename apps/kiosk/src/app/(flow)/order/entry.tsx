import { StyleSheet, View } from 'react-native';

import type { KioskEntryNode } from '@platform/domain';

import { MenuUnavailable } from '@/components/chrome/menu-unavailable';
import { StepHeading } from '@/components/chrome/step-heading';
import { Constellation } from '@/components/circle/constellation';
import { useKioskMenu } from '@/data/menu-store';
import { useFlow } from '@/state/flow';
import { TENANT } from '@/tenant';

/**
 * The first screen, and the one that is entirely the tenant's.
 *
 * Nothing here knows what a coffee shop sells. It renders whatever
 * `brand_config.kiosk.entry.nodes` says, and when a tenant has configured
 * nothing the resolver has already derived a screen from their menu -- so a
 * franchise onboarded this morning opens on something a guest can press.
 */
export default function EntryStep() {
  const { flow, learn, goTo, goNext, select, openUtility } = useFlow();
  const { status, refresh } = useKioskMenu();

  function choose(node: KioskEntryNode) {
    switch (node.target.kind) {
      case 'group':
        select(node);
        learn({ inGroup: true });
        goTo('node');
        return;
      case 'category':
      case 'item':
        select(node);
        goNext({ inGroup: false });
        return;
      case 'utility':
        openUtility(node.target.utility);
        return;
    }
  }

  // A configured kiosk that cannot read its menu says so. Rendering the
  // constellation anyway would draw whatever the resolver could derive from an
  // empty menu -- a screen with nothing on it, or worse, a screen that looks
  // like a shop with nothing to sell.
  if (status !== 'live' && status !== 'demo') {
    return <MenuUnavailable status={status} onRetry={refresh} />;
  }

  return (
    <View style={styles.root}>
      <StepHeading title={flow.entry.prompt} />
      <Constellation
        nodes={flow.entry.nodes}
        monogram={TENANT.business?.monogram}
        onSelect={choose}
      />
    </View>
  );
}

const styles = StyleSheet.create({ root: { flex: 1, paddingHorizontal: 32, paddingBottom: 24 } });
