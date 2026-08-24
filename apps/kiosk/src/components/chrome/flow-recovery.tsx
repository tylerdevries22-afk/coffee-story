import { StyleSheet, View } from 'react-native';

import { KioskPressable } from '@/components/chrome/kiosk-pressable';
import { StepHeading } from '@/components/chrome/step-heading';

/** Visible fallback while a stale or incomplete route returns to ordering. */
export function FlowRecovery({ onRecover }: { onRecover: () => void }) {
  return (
    <View accessibilityLiveRegion="polite" style={styles.root}>
      <StepHeading
        title="Let's choose that again"
        hint="That item is no longer ready to customize. We're returning you to the menu."
      />
      <KioskPressable label="Back to the menu" onPress={onRecover} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 28, paddingHorizontal: 32 },
});
