import { Text, View } from 'react-native';

import { styles } from './cart-section';

export type Step = 'review' | 'payment' | 'complete';

export function stepSubtitle(step: Step): string {
  if (step === 'review') return 'Ring up services, add-ons, and gift certificates';
  if (step === 'payment') return 'Take payment';
  return 'Sale complete';
}

/** 1 Review → 2 Payment. Review stays filled once payment is reached. */
export function StepIndicator({ step }: { step: Exclude<Step, 'complete'> }) {
  return (
    <View style={styles.stepper}>
      {(['review', 'payment'] as const).map((name, index) => {
        const filled = step === name || (name === 'review' && step === 'payment');
        const label = name === 'review' ? 'Review' : 'Payment';
        return (
          <View key={name} style={styles.stepItem}>
            <View style={[styles.stepDot, filled && styles.stepDotFilled]}>
              <Text style={[styles.stepDotText, filled && styles.stepDotTextFilled]}>{index + 1}</Text>
            </View>
            <Text
              accessibilityLabel={`Step ${index + 1}, ${label}`}
              style={[styles.stepLabel, step === name && styles.stepLabelActive]}
            >
              {label}
            </Text>
            {index === 0 ? <View style={styles.stepRule} /> : null}
          </View>
        );
      })}
    </View>
  );
}
