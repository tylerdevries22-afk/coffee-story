import { StyleSheet, View } from 'react-native';

import { StepHeading } from '@/components/chrome/step-heading';
import { KioskPressable } from '@/components/chrome/kiosk-pressable';
import { CircleTile } from '@/components/circle/circle-tile';
import { useFlow } from '@/state/flow';

const METHOD_LABEL = { phone: 'Phone number', scan: 'Scan the app' } as const;

/**
 * How to find the guest's account.
 *
 * Skipping is a first-class action, not a small link: PRODUCT-MECHANICS is
 * explicit that identifying must never block an anonymous purchase, and a guest
 * who cannot remember their number still gets their coffee.
 */
export default function IdentifyStep() {
  const { flow, goNext, goTo } = useFlow();

  return (
    <View style={styles.root}>
      <StepHeading
        title="Do you have an account with us?"
        hint="Only if you want the balance on this order."
      />

      <View style={styles.methods}>
        {flow.identify.methods.map((method, index) => (
          <CircleTile
            key={method}
            index={index}
            label={METHOD_LABEL[method]}
            variant="kioskMinor"
            request={{ label: METHOD_LABEL[method] }}
            onPress={() => goNext({ identifyMethod: method })}
          />
        ))}
      </View>

      <KioskPressable
        label="No thanks, carry on"
        variant="secondary"
        // Straight past the balance branch: nothing was identified, so there is
        // no balance to apply and the order settles on its own.
        onPress={() => { goTo('processing'); }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: 'center', paddingHorizontal: 32, gap: 36 },
  methods: { flexDirection: 'row', gap: 56, justifyContent: 'center' },
});
