import { useEffect, useState } from 'react';
import {
  Pressable,
  Text,
  TextInput,
  View
} from 'react-native';

import {
  canCancelWithoutRefund,
  isPaymentDue,
  nextActionFor,
  packContentsLabel,
  type BoardOrder
} from '@/features/operator/board';
import { formatMoney } from '@platform/domain';
import { disabledState, toggleState, useTokens as useBrandTokens } from '@platform/ui';

import { SheetShell } from './board-controls';
import { createStyles } from './board-styles';
export function OrderDetail({
  order,
  onClose,
  onAdvance,
  onCancel,
  onRefund,
}: {
  order: BoardOrder | null;
  onClose: () => void;
  onAdvance: (to: NonNullable<ReturnType<typeof nextActionFor>>['to']) => void;
  onCancel: () => void;
  onRefund: (amount: number | 'full') => void;
}) {
  const tokens = useBrandTokens();
  const styles = createStyles(tokens);
  const [refundOpen, setRefundOpen] = useState(false);
  const [refundAmount, setRefundAmount] = useState('');
  useEffect(() => {
    if (!order) {
      setRefundOpen(false);
      setRefundAmount('');
    }
  }, [order]);
  if (!order) return null;
  const action = nextActionFor(order);
  const paymentDue = isPaymentDue(order);
  const actionLabel = paymentDue ? `Collect ${formatMoney(order.totalCents)}` : action?.label;
  const partialCents = Math.round(Number.parseFloat(refundAmount.replace(/[^0-9.]/g, '') || '0') * 100);
  return (
    <SheetShell visible title={`Order ${order.shortCode} · ${order.guestName}`} onClose={onClose}>
      {order.lines.map((line, index) => {
        const packLabel = packContentsLabel(line.packContents ?? []);
        return (
          <View key={index} style={styles.detailLine}>
            <Text style={styles.detailLineName}>{line.quantity}× {line.name}</Text>
            {line.options.length > 0 ? <Text style={styles.detailLineOptions}>{line.options.join(' · ')}</Text> : null}
            {packLabel ? <Text style={styles.detailLineOptions}>{packLabel}</Text> : null}
            {line.note ? <Text style={styles.detailLineOptions}>“{line.note}”</Text> : null}
          </View>
        );
      })}
      {order.note ? <Text style={styles.cardNote}>“{order.note}”</Text> : null}
      <View style={styles.detailTotalRow}>
        <Text style={styles.detailTotalLabel}>{paymentDue ? 'Due at pickup' : 'Paid'}</Text>
        <Text style={styles.detailTotalValue}>{formatMoney(order.totalCents)}</Text>
      </View>

      {action ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${actionLabel} for order ${order.shortCode}`}
          onPress={() => { onAdvance(action.to); onClose(); }}
          style={({ pressed }) => [styles.detailPrimary, pressed && styles.pressed]}
        >
          <Text style={styles.detailPrimaryText}>{actionLabel}</Text>
        </Pressable>
      ) : null}

      {order.status !== 'refunded' && order.status !== 'cancelled' ? (
        <View style={styles.detailDangerRow}>
          {canCancelWithoutRefund(order) ? (
            <Pressable accessibilityRole="button" onPress={onCancel} style={({ pressed }) => [styles.detailQuiet, pressed && styles.pressed]}>
              <Text style={styles.detailQuietText}>Cancel order</Text>
            </Pressable>
          ) : null}
          {!paymentDue ? (
            <Pressable
              accessibilityRole="button"
              {...toggleState(refundOpen)}
              onPress={() => setRefundOpen((open) => !open)}
              style={({ pressed }) => [styles.detailQuiet, pressed && styles.pressed]}
            >
              <Text style={styles.detailQuietText}>Refund…</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {refundOpen ? (
        <View style={styles.refundBox}>
          <Text style={styles.refundHint}>
            Refunds settle through Square against the original payment. Demo
            marks the order refunded without moving money.
          </Text>
          <TextInput
            accessibilityLabel="Partial refund amount in dollars"
            value={refundAmount}
            onChangeText={setRefundAmount}
            keyboardType="decimal-pad"
            placeholder="0.00"
            placeholderTextColor={tokens.textMuted}
            style={styles.refundInput}
          />
          <View style={styles.detailDangerRow}>
            <Pressable
              accessibilityRole="button"
              {...disabledState(partialCents <= 0 || partialCents > order.totalCents)}
              disabled={partialCents <= 0 || partialCents > order.totalCents}
              onPress={() => onRefund(partialCents)}
              style={({ pressed }) => [styles.detailQuiet, pressed && styles.pressed]}
            >
              <Text style={styles.detailQuietText}>Refund {partialCents > 0 ? formatMoney(partialCents) : 'amount'}</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={() => onRefund('full')}
              style={({ pressed }) => [styles.detailDanger, pressed && styles.pressed]}
            >
              <Text style={styles.detailDangerText}>Refund {formatMoney(order.totalCents)} (full)</Text>
            </Pressable>
          </View>
        </View>
      ) : null}
    </SheetShell>
  );
}
