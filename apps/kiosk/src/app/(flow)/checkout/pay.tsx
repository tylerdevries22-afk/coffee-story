import { StyleSheet, Text, View } from 'react-native';

import { formatMoney, orderSubtotalCents, orderTotals, settlementFor, type KioskTender } from '@platform/domain';
import { useTokens } from '@platform/ui';

import { StepHeading } from '@/components/chrome/step-heading';
import { CircleTile } from '@/components/circle/circle-tile';
import { useFlow } from '@/state/flow';
import { useKioskSession } from '@/state/session';
import { TENANT_TAX } from '@/tenant/tax';

const TENDER_LABEL: Record<KioskTender, string> = {
  card: 'Credit / Debit',
  cash: 'Pay at the counter',
  gift_card: 'Gift card',
  stored_value: 'Rewards balance',
};

/**
 * "How would you like to pay?"
 *
 * The totals card is above the choice on purpose: a guest should see what they
 * are about to be charged before they pick how, and the tax rows are the
 * tenant's own -- itemised, because each authority is rounded on its own and
 * the printed rows must add up to the printed total.
 */
export default function PayStep() {
  const tokens = useTokens();
  const { flow, goNext } = useFlow();
  const { cart } = useKioskSession();

  const totals = orderTotals({
    subtotalCents: orderSubtotalCents(cart),
    jurisdictions: TENANT_TAX,
  });

  function choose(tender: KioskTender) {
    const settlement = settlementFor(tender);
    // A balance does not settle an order; it opens the identify step and the
    // remainder is taken by a wire tender afterwards.
    goNext({
      identifyOffered: settlement.kind === 'balance' && flow.identify.mode !== 'off',
      identifyMethod: flow.identify.methods[0] ?? null,
    });
  }

  return (
    <View style={styles.root}>
      <StepHeading title="How would you like to pay?" />

      <View style={[styles.card, { backgroundColor: tokens.surfaceElevated, borderRadius: tokens.radius.lg }]}>
        <Row label="Subtotal" value={formatMoney(totals.subtotalCents)} />
        {totals.taxRows.map((row) => (
          <Row key={row.id} label={row.label} value={formatMoney(row.amountCents)} muted />
        ))}
        {totals.tipCents > 0 ? <Row label="Tip" value={formatMoney(totals.tipCents)} muted /> : null}
        <View style={[styles.divider, { backgroundColor: `${tokens.textMuted}33` }]} />
        <Row label="Total" value={formatMoney(totals.totalCents)} strong />
      </View>

      <View style={styles.tenders}>
        {flow.tenders.map((tender, index) => (
          <CircleTile
            key={tender}
            index={index}
            label={TENDER_LABEL[tender]}
            variant="kioskMinor"
            request={{ label: TENDER_LABEL[tender] }}
            onPress={() => choose(tender)}
          />
        ))}
      </View>
    </View>
  );
}

function Row({ label, value, muted, strong }: { label: string; value: string; muted?: boolean; strong?: boolean }) {
  const tokens = useTokens();
  const size = strong ? tokens.type.xxl : tokens.type.lg;
  const color = muted ? tokens.textMuted : tokens.textPrimary;
  return (
    <View style={styles.row}>
      <Text style={{ color, fontFamily: tokens.fontBody, fontSize: size, fontWeight: strong ? '700' : '400' }}>
        {label}
      </Text>
      <Text style={{ color, fontFamily: tokens.fontBody, fontSize: size, fontWeight: strong ? '700' : '600' }}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: 'center', paddingHorizontal: 32, gap: 28 },
  card: { width: 560, padding: 28, gap: 10 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  divider: { height: 1, marginVertical: 6 },
  tenders: { flexDirection: 'row', gap: 56, justifyContent: 'center', flexWrap: 'wrap' },
});
