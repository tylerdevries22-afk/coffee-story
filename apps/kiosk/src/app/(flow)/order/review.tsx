import { StyleSheet, Text, View } from 'react-native';

import { formatMoney } from '@platform/domain';
import { useTokens } from '@platform/ui';

import { KioskPressable } from '@/components/chrome/kiosk-pressable';
import { KioskStepper } from '@/components/chrome/kiosk-stepper';
import { StepHeading } from '@/components/chrome/step-heading';
import { KioskMenuImage } from '@/components/menu-image';
import * as haptics from '@/lib/haptics';
import { useBuilder } from '@/state/builder';
import { useFlow } from '@/state/flow';
import { useKioskSession } from '@/state/session';
import TENANT from '@/tenant/brand.json';

/**
 * "How does this look?"
 *
 * The last chance to change anything before it joins the bag, and the only
 * screen that shows the line as a whole. Money rides the primary action
 * (docs/DESIGN.md) so the cost of a choice sits where the hand already is.
 */
export default function ReviewStep() {
  const tokens = useTokens();
  const { goNext } = useFlow();
  const builder = useBuilder();
  const { addLine, cart } = useKioskSession();
  const item = builder.state.item;

  if (!item) return null;

  function addToBag() {
    const line = builder.toOrderLine();
    if (!line) return;
    haptics.landed();
    addLine(line);
    builder.reset();
    // The bag count is what makes checkout reachable, so it rides the advance:
    // set separately, `canAdvance` would still see an empty bag.
    goNext({ bagCount: cart.lines.length + 1, hasOptions: false });
  }

  return (
    <View style={styles.root}>
      <StepHeading title="How does this look?" />

      <View style={styles.stage}>
        <KioskMenuImage
          request={{ imageSlug: item.id, monogram: TENANT.business?.monogram, label: item.name }}
          variant="kioskHero"
          alt={item.name}
        />
        <Text style={[styles.name, { color: tokens.textPrimary, fontFamily: tokens.fontDisplay, fontSize: tokens.type.xxl }]}>
          {item.name}
        </Text>
        <Text style={[styles.summary, { color: tokens.textMuted, fontFamily: tokens.fontBody, fontSize: tokens.type.lg }]}>
          {builder.toOrderLine()?.optionSummary || 'As it comes'}
        </Text>
      </View>

      <View style={styles.quantity}>
        <Text style={[styles.quantityLabel, { color: tokens.textMuted, fontFamily: tokens.fontBody, fontSize: tokens.type.md }]}>
          Quantity
        </Text>
        <KioskStepper
          value={builder.state.quantity}
          onChange={(next) => builder.changeQuantity(next - builder.state.quantity)}
        />
      </View>

      <View style={styles.footer}>
        <KioskPressable
          label="Add to bag"
          trailing={formatMoney(builder.lineTotalCents)}
          onPress={addToBag}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: 32, alignItems: 'center' },
  stage: { alignItems: 'center', gap: 12, paddingTop: 8 },
  name: {},
  summary: { textAlign: 'center', maxWidth: 640 },
  quantity: { alignItems: 'center', gap: 10, paddingTop: 22 },
  quantityLabel: { letterSpacing: 1.2, textTransform: 'uppercase' },
  footer: { paddingTop: 24 },
});
