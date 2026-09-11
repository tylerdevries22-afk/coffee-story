import {
  Pressable,
  Text,
  View
} from 'react-native';

import {
  isPaymentDue,
  nextActionFor,
  packContentsLabel,
  type BoardOrder
} from '@/features/operator/board';
import { formatMoney } from '@platform/domain';
import { useTokens as useBrandTokens } from '@platform/ui';

import { createStyles } from './board-styles';

function ageLabel(placedAt: string, now: Date): string {
  const minutes = Math.max(0, Math.round((now.getTime() - new Date(placedAt).getTime()) / 60_000));
  return minutes === 0 ? 'now' : `${minutes}m`;
}

export function OrderCard({
  order,
  queuePosition,
  now,
  kds,
  fresh,
  onOpen,
  onAdvance,
}: {
  order: BoardOrder;
  /** What the wall display shows this guest, or null once they are ready. */
  queuePosition: number | null;
  now: Date;
  kds: boolean;
  fresh: boolean;
  onOpen: () => void;
  onAdvance: (to: NonNullable<ReturnType<typeof nextActionFor>>['to']) => void;
}) {
  const tokens = useBrandTokens();
  const styles = createStyles(tokens);
  const action = nextActionFor(order);
  const paymentDue = isPaymentDue(order);
  const actionLabel = paymentDue ? `Collect ${formatMoney(order.totalCents)}` : action?.label;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Order ${order.shortCode} for ${order.guestName}, ${ageLabel(order.placedAt, now)} old. Open details`}
      onPress={onOpen}
      style={({ pressed }) => [styles.card, fresh && styles.cardFresh, pressed && styles.pressed]}
    >
      <View style={styles.cardTop}>
        <Text style={[styles.cardCode, kds && styles.cardCodeKds]}>{order.shortCode}</Text>
        <Text style={styles.cardGuest}>{order.guestName}</Text>
        {/*
          What the guest is looking at.
          The wall shows a place in line, not the short code, so a barista
          asked "what number am I?" had nothing to answer with. Same function
          computes both (queuePositions, @platform/domain), so this and the
          screen behind the counter cannot disagree.
        */}
        {queuePosition !== null ? (
          <Text style={styles.cardQueue}>#{queuePosition}</Text>
        ) : null}
        <Text style={styles.cardAge}>{ageLabel(order.placedAt, now)}</Text>
      </View>
      {order.lines.map((line, index) => {
        const packLabel = packContentsLabel(line.packContents ?? []);
        return (
          <View key={index}>
            <Text style={[styles.cardLine, kds && styles.cardLineKds]} numberOfLines={2}>
              {line.quantity}× {line.name}
              {line.options.length > 0 ? ` · ${line.options.join(', ')}` : ''}
            </Text>
            {packLabel ? <Text style={styles.cardNote}>{packLabel}</Text> : null}
            {line.note ? <Text style={styles.cardNote}>“{line.note}”</Text> : null}
          </View>
        );
      })}
      {order.note ? <Text style={styles.cardNote}>“{order.note}”</Text> : null}
      <View style={styles.cardBottom}>
        {kds ? <View /> : (
          <Text style={styles.cardTotal}>{paymentDue ? 'Due ' : ''}{formatMoney(order.totalCents)}</Text>
        )}
        {action ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${actionLabel} for order ${order.shortCode}`}
            onPress={(event) => {
              event.stopPropagation();
              onAdvance(action.to);
            }}
            style={({ pressed }) => [styles.advance, pressed && styles.pressed]}
          >
            <Text style={styles.advanceText}>{actionLabel}</Text>
          </Pressable>
        ) : null}
      </View>
    </Pressable>
  );
}
