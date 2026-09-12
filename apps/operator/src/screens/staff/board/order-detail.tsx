import { useEffect, useRef, useState } from 'react';
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
import type { ActionOutcome } from '@/state/operator-store-types';
import { formatMoney } from '@platform/domain';
import { disabledState, toggleState, useTokens as useBrandTokens } from '@platform/ui';

import {
  actionDismissed,
  actionFailed,
  actionStarted,
  actionSucceeded,
  idleActionRequest,
  isActionPending,
  type ActionKind,
  type ActionRequestState,
} from './action-request-state';
import { SheetShell } from './board-controls';
import { createStyles } from './board-styles';
import { OrderDetailStatus } from './order-detail-status';
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
  onCancel: () => Promise<ActionOutcome>;
  onRefund: (amount: number | 'full') => Promise<ActionOutcome>;
}) {
  const tokens = useBrandTokens();
  const styles = createStyles(tokens);
  const [refundOpen, setRefundOpen] = useState(false);
  const [refundAmount, setRefundAmount] = useState('');
  const [actionRequest, setActionRequest] = useState<ActionRequestState>(idleActionRequest);
  const orderIdRef = useRef<string | null>(null);
  const retryRef = useRef<() => void>(() => undefined);
  useEffect(() => {
    orderIdRef.current = order?.id ?? null;
  }, [order]);
  useEffect(() => {
    if (!order) {
      setRefundOpen(false);
      setRefundAmount('');
      setActionRequest(idleActionRequest);
    }
  }, [order]);
  if (!order) return null;
  const runAction = (kind: ActionKind, perform: () => Promise<ActionOutcome>) => {
    const orderId = order.id;
    retryRef.current = () => runAction(kind, perform);
    setActionRequest(actionStarted(kind));
    void perform().then((outcome) => {
      // The sheet may already be showing a different order (or none) by the
      // time this resolves; the conflicts banner is the record for that case.
      if (orderIdRef.current !== orderId) return;
      if (outcome.ok) { setActionRequest(actionSucceeded()); onClose(); }
      else setActionRequest(actionFailed(kind, outcome.message));
    });
  };
  const pending = isActionPending(actionRequest);
  const nextAction = nextActionFor(order);
  const paymentDue = isPaymentDue(order);
  const actionLabel = paymentDue ? `Collect ${formatMoney(order.totalCents)}` : nextAction?.label;
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

      {nextAction ? (
        <Pressable
          accessibilityRole="button"
          {...disabledState(pending)}
          disabled={pending}
          accessibilityLabel={`${actionLabel} for order ${order.shortCode}`}
          onPress={() => { onAdvance(nextAction.to); onClose(); }}
          style={({ pressed }) => [styles.detailPrimary, pressed && styles.pressed]}
        >
          <Text style={styles.detailPrimaryText}>{actionLabel}</Text>
        </Pressable>
      ) : null}

      {order.status !== 'refunded' && order.status !== 'cancelled' ? (
        <View style={styles.detailDangerRow}>
          {canCancelWithoutRefund(order) ? (
            <Pressable
              accessibilityRole="button"
              {...disabledState(pending)}
              disabled={pending}
              onPress={() => runAction('cancel', onCancel)}
              style={({ pressed }) => [styles.detailQuiet, pressed && styles.pressed]}
            >
              <Text style={styles.detailQuietText}>Cancel order</Text>
            </Pressable>
          ) : null}
          {!paymentDue ? (
            <Pressable
              accessibilityRole="button"
              {...toggleState(refundOpen)}
              {...disabledState(pending)}
              disabled={pending}
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
              {...disabledState(pending || partialCents <= 0 || partialCents > order.totalCents)}
              disabled={pending || partialCents <= 0 || partialCents > order.totalCents}
              onPress={() => runAction('refund', () => onRefund(partialCents))}
              style={({ pressed }) => [styles.detailQuiet, pressed && styles.pressed]}
            >
              <Text style={styles.detailQuietText}>Refund {partialCents > 0 ? formatMoney(partialCents) : 'amount'}</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              {...disabledState(pending)}
              disabled={pending}
              onPress={() => runAction('refund', () => onRefund('full'))}
              style={({ pressed }) => [styles.detailDanger, pressed && styles.pressed]}
            >
              <Text style={styles.detailDangerText}>Refund {formatMoney(order.totalCents)} (full)</Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      {actionRequest.phase !== 'idle' ? (
        <OrderDetailStatus
          state={actionRequest}
          onRetry={() => retryRef.current()}
          onDismiss={() => setActionRequest(actionDismissed())}
        />
      ) : null}
    </SheetShell>
  );
}
