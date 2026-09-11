import * as Haptics from 'expo-haptics';
import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

import {
  TIP_PRESETS_CENTS,
  formatMoney,
  formatRate,
  type OrderTotals,
} from '@platform/domain';
import { choiceState, useTokens as useBrandTokens } from '@platform/ui';

import { createStyles } from './checkout-step-styles';
import type { StoredValueControl } from './checkout-types';

export function CheckoutReceipt({
  cardChargeCents,
  onTipChange,
  storedValue,
  totals,
}: {
  cardChargeCents?: number;
  onTipChange: (cents: number) => void;
  storedValue?: StoredValueControl | null;
  totals: OrderTotals;
}) {
  const tokens = useBrandTokens();
  const styles = createStyles(tokens);
  const [customTipOpen, setCustomTipOpen] = useState(false);
  const [customTip, setCustomTip] = useState('');
  const isPreset = TIP_PRESETS_CENTS.includes(totals.tipCents);
  const chooseTip = (cents: number) => {
    void Haptics.selectionAsync().catch(() => undefined);
    setCustomTipOpen(false);
    setCustomTip('');
    onTipChange(cents);
  };
  const openCustomTip = () => {
    void Haptics.selectionAsync().catch(() => undefined);
    setCustomTip(totals.tipCents > 0 ? (totals.tipCents / 100).toFixed(2) : '');
    setCustomTipOpen(true);
  };
  const applyCustomTip = (raw: string) => {
    setCustomTip(raw);
    const dollars = Number.parseFloat(raw.replace(/[^0-9.]/g, ''));
    onTipChange(Number.isFinite(dollars) ? Math.round(dollars * 100) : 0);
  };
  return (
    <View style={styles.card}>
      <Text accessibilityRole="header" style={styles.cardTitle}>Order Details</Text>
      <ReceiptRow label="Subtotal" value={formatMoney(totals.subtotalCents)} />
      {totals.deliveryFeeCents > 0 ? <ReceiptRow label="Delivery" value={formatMoney(totals.deliveryFeeCents)} /> : null}
      {totals.discountCents > 0 ? <ReceiptRow label="Discount" value={`-${formatMoney(totals.discountCents)}`} /> : null}
      {totals.taxRows.map((row) => (
        <ReceiptRow key={row.id} label={`${row.label} (${formatRate(row.rate)})`} value={formatMoney(row.amountCents)} />
      ))}
      <ReceiptRow label="Tip" value={formatMoney(totals.tipCents)} />
      <View accessibilityRole="radiogroup" style={styles.tipRow}>
        {TIP_PRESETS_CENTS.map((preset) => (
          <TipChip key={preset} label={formatMoney(preset)} selected={totals.tipCents === preset && !customTipOpen} onPress={() => chooseTip(preset)} />
        ))}
        <TipChip label="Other" selected={customTipOpen || (!isPreset && totals.tipCents > 0)} onPress={openCustomTip} />
      </View>
      {customTipOpen ? (
        <TextInput accessibilityLabel="Custom tip amount in dollars" value={customTip} onChangeText={applyCustomTip} keyboardType="decimal-pad" placeholder="0.00" placeholderTextColor={tokens.textMuted} autoFocus style={styles.tipInput} />
      ) : null}
      <Text style={styles.tipCaption}>100% of tips go to the service team.</Text>
      <View style={styles.totalRow}>
        <Text style={styles.totalLabel}>Total</Text>
        <Text style={styles.totalValue}>{formatMoney(totals.totalCents)}</Text>
      </View>
      {storedValue && storedValue.appliedCents > 0 ? (
        <>
          <ReceiptRow label="Gift balance applied" value={`-${formatMoney(storedValue.appliedCents)}`} />
          <ReceiptRow label="Card charge" value={formatMoney(cardChargeCents ?? totals.totalCents)} />
        </>
      ) : null}
    </View>
  );
}

function ReceiptRow({ label, value }: { label: string; value: string }) {
  const styles = createStyles(useBrandTokens());
  return <View style={styles.receiptRow}><Text style={styles.receiptLabel}>{label}</Text><Text style={styles.receiptValue}>{value}</Text></View>;
}

function TipChip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  const styles = createStyles(useBrandTokens());
  return (
    <Pressable accessibilityRole="radio" accessibilityLabel={label === 'Other' ? 'Other tip amount' : `${label} tip`} {...choiceState(selected)} onPress={onPress} style={({ pressed }) => [styles.tipChip, selected && styles.tipChipSelected, pressed && styles.pressed]}>
      <Text style={[styles.tipChipText, selected && styles.tipChipTextSelected]}>{label}</Text>
    </Pressable>
  );
}
