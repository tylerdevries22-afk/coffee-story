import { Pressable, StyleSheet, Text, View } from 'react-native';

import { formatMoney, orderSubtotalCents, orderTotals } from '@platform/domain';
import { toggleState, useTokens } from '@platform/ui';

import { KioskPressable } from '@/components/chrome/kiosk-pressable';
import { StepHeading } from '@/components/chrome/step-heading';
import * as haptics from '@/lib/haptics';
import { useFlow } from '@/state/flow';
import { useKioskSession } from '@/state/session';
import { TENANT_TAX } from '@/tenant/tax';

export default function TipStep() {
  const tokens = useTokens();
  const { flow, goNext } = useFlow();
  const { cart, tipCents, setTipCents } = useKioskSession();
  const totals = orderTotals({
    subtotalCents: orderSubtotalCents(cart),
    tipCents,
    jurisdictions: TENANT_TAX,
  });
  const choices = [0, ...flow.tip.presetsCents];

  return (
    <View style={[styles.root, { paddingHorizontal: tokens.spacing.xxl, gap: tokens.spacing.xl }]}>
      <StepHeading title="Add a tip?" hint="Every tip goes to the team." />
      <View style={[styles.choices, { gap: tokens.spacing.lg }]}>
        {choices.map((amount) => {
          const selected = amount === tipCents;
          const label = amount === 0 ? 'No tip' : formatMoney(amount);
          return (
            <Pressable
              key={amount}
              accessibilityRole="button"
              accessibilityLabel={label}
              {...toggleState(selected)}
              onPress={() => { haptics.tapped(); setTipCents(amount); }}
              style={[
                styles.choice,
                {
                  borderColor: selected ? tokens.primary : tokens.textMuted,
                  backgroundColor: selected ? tokens.primary : tokens.surfaceElevated,
                  borderRadius: tokens.radius.lg,
                  paddingHorizontal: tokens.spacing.xl,
                },
              ]}
            >
              <Text style={{
                color: selected ? tokens.surfaceElevated : tokens.textPrimary,
                fontFamily: tokens.fontBody,
                fontSize: tokens.type.xxl,
                fontWeight: '700',
              }}>
                {label}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <KioskPressable
        label="Continue"
        trailing={formatMoney(totals.totalCents)}
        onPress={goNext}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: 'center' },
  choices: { flexDirection: 'row', justifyContent: 'center', flexWrap: 'wrap' },
  choice: {
    minWidth: 200,
    minHeight: 96,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
