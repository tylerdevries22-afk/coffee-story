import { useCallback, useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { CollapsingScreen } from '@/components/collapsing-screen';
import {
  demoConfirmationStatus
} from '@/features/order/demo-checkout';
import { POINTS_LABEL } from '@/features/rewards/presentation';
import { simulateProgress, trackingView } from '@/features/tracking';
import { platformApi } from '@/lib/api';
import { demoSyncClient } from '@/lib/demo-sync';
import { supabase } from '@/lib/supabase';
import {
  startSerializedPolling
} from '@platform/api-client';
import { subscribeToOrderStatus } from '@platform/data';
import {
  describePickupWindow,
  formatMoney
} from '@platform/domain';
import type { OrderStatus } from '@platform/schema';
import { AppIcon, disabledState, useTokens as useBrandTokens } from '@platform/ui';

import { createStyles } from './order-styles';
/* ----------------------------------------------------------- confirmation */

export function OrderPlaced({
  summary,
  guestName,
  windowValue,
  totalCents,
  pointsEarned,
  orderId,
  demoSynced,
  demoSyncSessionId,
  initialStatus,
  isDelivery,
  onViewVisits,
  onDone,
}: {
  summary: string;
  guestName: string;
  windowValue: string;
  totalCents: number;
  pointsEarned: number;
  /** Present for live orders: drives realtime tracking instead of the simulator. */
  orderId: string | null;
  demoSynced: boolean;
  demoSyncSessionId: string | null;
  initialStatus: OrderStatus;
  isDelivery: boolean;
  onViewVisits: () => void;
  onDone: () => void;
}) {
  const tokens = useBrandTokens();
  const styles = createStyles(tokens);
  const window = describePickupWindow(windowValue, new Date());
  // A live order streams rule-2's states over Realtime; the demo shop makes
  // the drink in front of you on believable delays. Both render the same
  // timeline.
  const [status, setStatus] = useState<OrderStatus>(initialStatus);
  useEffect(() => {
    const syncClient = demoSyncClient;
    if (orderId && demoSynced && demoSyncSessionId && syncClient) {
      let active = true;
      const stop = startSerializedPolling(async () => {
        const snapshot = await syncClient.orders();
        if (active) {
          setStatus((current) => demoConfirmationStatus(
            current, orderId, demoSyncSessionId, snapshot,
          ));
        }
      }, 1_000);
      return () => { active = false; stop(); };
    }
    if (orderId) return subscribeToOrderStatus(supabase, orderId, setStatus);
    return simulateProgress(setStatus);
  }, [demoSyncSessionId, demoSynced, orderId]);
  const tracking = trackingView(status);

  // Calling it off is only offered while it is still true: once the shop
  // starts the drink the button disappears rather than failing on tap.
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const canCancel = Boolean(orderId) && status === 'created';
  const onCancel = useCallback(() => {
    if (!orderId) return;
    setCancelling(true);
    setCancelError(null);
    const cancellation = demoSynced && demoSyncClient
      ? demoSyncClient.transition(orderId, 'cancelled')
      : platformApi?.cancelOrder({ orderId });
    if (!cancellation) {
      setCancelling(false);
      setCancelError('Cancellation is not configured.');
      return;
    }
    cancellation
      .then(() => setStatus('cancelled'))
      .catch((error: unknown) => {
        setCancelError(error instanceof Error
          ? error.message
          : 'That did not go through. Try again, or ask the shop.');
      })
      .finally(() => setCancelling(false));
  }, [demoSynced, orderId]);
  return (
    <CollapsingScreen
      title="Order placed"
      onBack={onDone}
      backLabel="Order"
      style={styles.page}
      headerBackgroundColor={tokens.surface}
      headerBorderColor={tokens.surface}
      contentContainerStyle={styles.content}
    >
      <View style={styles.placedCard}>
        <View style={styles.placedMark}>
          <AppIcon name="checkmark" size={26} tintColor={tokens.surfaceElevated} weight="bold" />
        </View>
        <Text style={styles.placedTitle}>
          {isDelivery ? 'On its way' : 'We’ll have it ready'}
        </Text>
        <Text style={styles.placedDetail}>
          {window
            ? `${isDelivery ? 'Delivering' : 'Ready for'} ${guestName || 'you'} ${window.dayLabel.toLowerCase()}, ${window.timeLabel}.`
            : `Thanks, ${guestName || 'friend'}.`}
        </Text>
        {summary ? <Text style={styles.placedSummary}>{summary}</Text> : null}
        <View style={styles.placedTotalRow}>
          <Text style={styles.placedTotalLabel}>{status === 'created' ? 'Due at counter' : 'Paid'}</Text>
          <Text style={styles.placedTotalValue}>{formatMoney(totalCents)}</Text>
        </View>
        <Text style={styles.placedNote}>
          {pointsEarned} {POINTS_LABEL} land on your account once the shop confirms the order.
        </Text>
      </View>

      <View accessibilityLiveRegion="polite" style={styles.trackCard}>
        {tracking.steps.map((step, index) => {
          const reached = tracking.activeIndex >= index;
          const current = tracking.activeIndex === index;
          return (
            <View key={step.status} style={styles.trackRow}>
              <View style={[styles.trackDot, reached && styles.trackDotReached, current && styles.trackDotCurrent]} />
              <View style={styles.trackCopy}>
                <Text style={[styles.trackTitle, !reached && styles.trackMuted]}>{step.title}</Text>
                {current ? <Text style={styles.trackDetail}>{step.detail}</Text> : null}
              </View>
            </View>
          );
        })}
      </View>

      {canCancel ? (
        <View style={styles.cancelBlock}>
          {cancelError ? <Text style={styles.cancelError}>{cancelError}</Text> : null}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Cancel this order"
            disabled={cancelling}
            {...disabledState(cancelling)}
            onPress={onCancel}
            style={({ pressed }) => [styles.cancelRow, pressed && styles.cardPressed]}
          >
            <Text style={styles.cancelText}>
              {cancelling ? 'Cancelling…' : 'Cancel this order'}
            </Text>
          </Pressable>
          <Text style={styles.cancelNote}>
            You can cancel until the shop starts making it.
          </Text>
        </View>
      ) : null}

      <Pressable
        accessibilityRole="button"
        onPress={onViewVisits}
        style={({ pressed }) => [styles.hubRow, pressed && styles.cardPressed]}
      >
        <View style={styles.hubIcon}>
          <AppIcon name="clock" size={22} tintColor={tokens.primary} />
        </View>
        <View style={styles.hubCopy}>
          <Text style={styles.hubTitle}>See your orders</Text>
          <Text style={styles.hubDetail}>Every order you have placed, with its status.</Text>
        </View>
        <AppIcon name="chevron.right" size={18} tintColor={tokens.textMuted} />
      </Pressable>
    </CollapsingScreen>
  );
}
