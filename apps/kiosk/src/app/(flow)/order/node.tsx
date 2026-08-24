import { StyleSheet, View } from 'react-native';

import type { KioskEntryNode } from '@platform/domain';

import { StepHeading } from '@/components/chrome/step-heading';
import { Constellation } from '@/components/circle/constellation';
import { useFlow } from '@/state/flow';
import TENANT from '@/tenant/brand.json';

/**
 * One level down from the first screen.
 *
 * A tenant whose first question is broad -- "Large or mini?" before "which
 * one?" -- gets one narrowing screen and no more. `resolveKioskFlow` refuses a
 * second level of nesting: a kiosk is a linear task, and a guest who can get
 * three taps deep into groups has been handed a file browser.
 */
export default function NodeStep() {
  const { selected, group, select, goNext, goTo } = useFlow();

  function choose(node: KioskEntryNode) {
    select(node);
    if (node.target.kind === 'group') {
      // Cannot happen -- the resolver drops nested groups -- but landing back
      // here would be a loop, so it goes forward instead.
      goTo('entry');
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
