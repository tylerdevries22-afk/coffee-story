import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useTokens, withAlpha } from '@platform/ui';

import { stepperDecreaseLabel } from '@/features/kiosk-stepper';
import * as haptics from '@/lib/haptics';

/**
 * A quantity control at kiosk scale.
 *
 * `packages/ui`'s QuantityStepper is 40x40 -- a phone target. FIVE-SURFACES
 * puts the floor on this surface at 60pt because the guest is standing two to
 * three feet away, so reusing it would have shipped a control a third too small
 * on the one screen where a mis-tap costs money.
 *
 * The accessibility contract is copied deliberately: the value is a live
 * region, so a screen reader announces the change rather than the button, and
 * both `accessibilityState` and the matching `aria-*` are emitted because
 * react-native-web drops the former on Pressable.
 */
export function KioskStepper({
  value,
  min = 1,
  max = 20,
  onChange,
  label = 'Quantity',
}: {
  value: number;
  min?: number;
  max?: number;
  onChange: (next: number) => void;
  label?: string;
}) {
  const tokens = useTokens();
  const canDecrease = value > min;
  const canIncrease = value < max;

  const control = (name: 'Decrease' | 'Increase', enabled: boolean, next: number) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={name === 'Decrease'
        ? stepperDecreaseLabel(value, min, label)
        : `Increase ${label.toLowerCase()}`}
      accessibilityState={{ disabled: !enabled }}
      aria-disabled={!enabled}
      disabled={!enabled}
      onPress={() => { haptics.tapped(); onChange(next); }}
      style={({ pressed }) => [
        styles.control,
        {
          borderRadius: tokens.radius.pill,
          backgroundColor: enabled ? withAlpha(tokens.primary, 0.08) : withAlpha(tokens.textMuted, 0.06),
          opacity: pressed ? 0.7 : 1,
        },
      ]}
    >
      <Text style={{
        color: enabled ? tokens.textPrimary : tokens.textMuted,
        fontFamily: tokens.fontBody, fontSize: tokens.type.xxl,
      }}>
        {name === 'Increase' ? '+' : '−'}
      </Text>
    </Pressable>
  );

  return (
    <View style={styles.row}>
      {control('Decrease', canDecrease, value - 1)}
      <Text
        accessibilityLiveRegion="polite"
        style={[styles.value, { color: tokens.textPrimary, fontFamily: tokens.fontBody, fontSize: tokens.type.xxl }]}
      >
        {value}
      </Text>
      {control('Increase', canIncrease, value + 1)}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 24 },
  // 72pt: comfortably over the 60pt floor FIVE-SURFACES sets for this surface.
  control: { width: 72, height: 72, alignItems: 'center', justifyContent: 'center' },
  value: { minWidth: 48, textAlign: 'center', fontWeight: '700' },
});
