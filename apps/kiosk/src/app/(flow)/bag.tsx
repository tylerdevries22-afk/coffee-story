import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { formatMoney, orderLineTotalCents, orderSubtotalCents, orderTotals } from '@platform/domain';
import { useCopy, useTokens } from '@platform/ui';

import { KioskPressable } from '@/components/chrome/kiosk-pressable';
import { KioskStepper } from '@/components/chrome/kiosk-stepper';
import { StepHeading } from '@/components/chrome/step-heading';
import { KioskMenuImage } from '@/components/menu-image';
import { useFlow } from '@/state/flow';
import { useKioskSession } from '@/state/session';
import TENANT from '@/tenant/brand.json';
import { TENANT_TAX } from '@/tenant/tax';

/**
 * The bag.
 *
 * A screen rather than the permanent rail the first kiosk had: a guided flow
 * already tells the guest where they are, and a rail that is empty for the
 * first four steps spends a third of a landscape screen saying nothing.
 */
export default function BagStep() {
  const tokens = useTokens();
  const copy = useCopy();
  const { goNext, goTo, learn } = useFlow();
  const { cart, changeQuantity, removeLine } = useKioskSession();

  const totals = orderTotals({
    subtotalCents: orderSubtotalCents(cart),
    jurisdictions: TENANT_TAX,
  });
  const empty = cart.lines.length === 0;

  return (
    <View style={styles.root}>
      <StepHeading title={copy('bagTitle')} hint={empty ? undefined : `${cart.lines.length} in your bag`} />

      {empty ? (
        <View style={styles.empty}>
          <Text style={[styles.emptyText, { color: tokens.textMuted, fontFamily: tokens.fontBody, fontSize: tokens.type.xl }]}>
            Nothing here yet.
          </Text>
          <KioskPressable label="Back to the menu" variant="secondary" onPress={() => goTo('entry')} />
        </View>
      ) : (
        <>
          <ScrollView contentContainerStyle={styles.lines}>
            {cart.lines.map((line) => (
              <View key={line.id} style={[styles.line, { borderColor: `${tokens.textMuted}33` }]}>
                <KioskMenuImage
                  request={{ imageSlug: line.itemId, monogram: TENANT.business?.monogram, label: line.name }}
                  variant="kioskLine"
                  alt=""
                />
                <View style={styles.lineCopy}>
                  <Text numberOfLines={2} style={[styles.lineName, { color: tokens.textPrimary, fontFamily: tokens.fontBody, fontSize: tokens.type.xl }]}>
                    {line.name}
                  </Text>
                  <Text numberOfLines={2} style={[styles.lineMeta, { color: tokens.textMuted, fontFamily: tokens.fontBody, fontSize: tokens.type.md }]}>
                    {line.optionSummary || line.sizeLabel}
                  </Text>
                </View>
                <KioskStepper
                  value={line.quantity}
                  min={0}
                  label={line.name}
                  onChange={(next) => {
                    if (next <= 0) removeLine(line.id);
                    else changeQuantity(line.id, next - line.quantity);
                    learn({ bagCount: next <= 0 ? cart.lines.length - 1 : cart.lines.length });
                  }}
                />
                <Text style={[styles.linePrice, { color: tokens.textPrimary, fontFamily: tokens.fontBody, fontSize: tokens.type.xl }]}>
                  {formatMoney(orderLineTotalCents(line))}
                </Text>
              </View>
            ))}
          </ScrollView>

          <View style={styles.footer}>
            <View style={styles.totals}>
              <Text style={[styles.totalLabel, { color: tokens.textMuted, fontFamily: tokens.fontBody, fontSize: tokens.type.lg }]}>
                Subtotal
              </Text>
              <Text style={[styles.totalValue, { color: tokens.textPrimary, fontFamily: tokens.fontBody, fontSize: tokens.type.xxl }]}>
                {formatMoney(totals.subtotalCents)}
              </Text>
            </View>
            <KioskPressable label={copy('checkoutTitle')} trailing={formatMoney(totals.totalCents)} onPress={goNext} />
          </View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: 48 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 24 },
  emptyText: {},
  lines: { paddingBottom: 20 },
  line: { flexDirection: 'row', alignItems: 'center', gap: 24, paddingVertical: 20, borderBottomWidth: 1 },
  lineCopy: { flex: 1, gap: 4 },
  lineName: { fontWeight: '700' },
  lineMeta: {},
  linePrice: { minWidth: 120, textAlign: 'right', fontWeight: '700' },
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 24, gap: 32 },
  totals: { gap: 2 },
  totalLabel: { letterSpacing: 1.1, textTransform: 'uppercase' },
  totalValue: { fontWeight: '700' },
});
