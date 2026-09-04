import { useEffect, useMemo, useRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { addOrderLine, formatMoney } from '@platform/domain';
import { useTokens } from '@platform/ui';

import { KioskPressable } from '@/components/chrome/kiosk-pressable';
import { KioskStepper } from '@/components/chrome/kiosk-stepper';
import { FlowRecovery } from '@/components/chrome/flow-recovery';
import { StepHeading } from '@/components/chrome/step-heading';
import { KioskMenuImage } from '@/components/menu-image';
import { useKioskMenu } from '@/data/menu-store';
import * as haptics from '@/lib/haptics';
import { useBuilder } from '@/state/builder';
import { useFlow } from '@/state/flow';
import { useKioskSession } from '@/state/session';
import { TENANT } from '@/tenant';

/**
 * "How does this look?"
 *
 * The last chance to change anything before it joins the bag, and the only
 * screen that shows the line as a whole. Money rides the primary action
 * (docs/DESIGN.md) so the cost of a choice sits where the hand already is.
 */
export default function ReviewStep() {
  const tokens = useTokens();
  const { goTo, learn, openCart } = useFlow();
  const builder = useBuilder();
  const { addLine, cart } = useKioskSession();
  const { menu } = useKioskMenu();
  const submitted = useRef(false);
  const item = builder.state.item;
  const packChoiceNames = useMemo(
    () => new Map(menu.items.map((entry) => [entry.id, entry.name])),
    [menu.items],
  );
  const line = item
    ? builder.toOrderLine((choiceId) => packChoiceNames.get(choiceId) ?? choiceId)
    : null;
  const recoveryTarget = submitted.current ? null : !item
    ? 'entry'
    : !line && item.packSize && !builder.packComplete(item.packSize)
      ? 'fill'
      : !line && builder.visibleGroups.length > 0
        ? 'options'
        : !line ? 'entry' : null;

  useEffect(() => {
    if (recoveryTarget) goTo(recoveryTarget);
  }, [goTo, recoveryTarget]);

  if (!item || !line) {
    if (submitted.current) return <View style={styles.root} />;
    return <FlowRecovery onRecover={() => goTo(recoveryTarget ?? 'entry')} />;
  }

  function addToBag() {
    if (!line) return;
    // Clearing the builder re-renders this page before Router finishes its
    // replace. Mark the intentional clear so the missing-item recovery effect
    // cannot race the bag navigation and send the guest back to the menu.
    submitted.current = true;
    haptics.landed();
    const nextCart = addOrderLine(cart, line);
    addLine(line);
    learn({ bagCount: nextCart.lines.length, hasOptions: false });
    builder.reset();
    // Preserve the menu underneath the transient cart rail. Navigating to a
    // full-stage bag here is what erased the reference interaction.
    goTo('entry');
    openCart();
  }

  return (
    <View style={styles.root}>
      <StepHeading title="How does this look?" />

      <View style={styles.stage}>
        <KioskMenuImage
          request={{
            imageSlug: item.id,
            imageUrl: item.imageUrl,
            monogram: TENANT.business?.monogram,
            label: item.name,
          }}
          variant="kioskHero"
          alt={item.name}
        />
        <Text style={[styles.name, { color: tokens.textPrimary, fontFamily: tokens.fontDisplay, fontSize: tokens.type.xxl }]}>
          {item.name}
        </Text>
        <Text style={[styles.summary, { color: tokens.textMuted, fontFamily: tokens.fontBody, fontSize: tokens.type.lg }]}>
          {line.optionSummary || 'As it comes'}
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
          label="Add to cart"
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
