import Constants from 'expo-constants';
import { useState } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';

import { Body, Button, Card } from '@/components/ui';
import { trackingView } from '@/features/tracking';
import { mobileApi } from '@/lib/mobile-api';
import { addOrderToCalendar } from '@/lib/native-adapters';
import { useDemo } from '@/state/demo-context';
import { choiceState } from '@platform/ui';
import { formatMoney, requestKey, type PortalOrder } from '@platform/domain';

import { useInformationStyles } from './information-page';
import { Field } from './profile-and-preferences';

export function UpcomingOrderCard({
  order, isDemo, upcoming, cancellable, reschedulable,
  onCancel, onReschedule, onReviewed,
}: {
  order: PortalOrder;
  isDemo: boolean;
  upcoming: boolean;
  cancellable: boolean;
  reschedulable: boolean;
  onCancel: () => Promise<void>;
  onReschedule: () => Promise<void>;
  onReviewed: () => Promise<void>;
}) {
  const styles = useInformationStyles();
  const demo = useDemo();
  const [reviewing, setReviewing] = useState(false);
  const [rating, setRating] = useState(5);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  return (
    <Card style={styles.detailCard}>
      <Text style={styles.detailTitle}>{order.summary}</Text>
      {packRecipeLines(order).map((recipe, index) => (
        <Body key={`${order.id}-pack-${index}`} muted>{recipe}</Body>
      ))}
      <Body muted>{formatOrderDate(order.scheduledFor ?? order.placedAt)}</Body>
      {order.locationLabel ? <Body>{order.locationLabel} · {order.locationDetail}</Body> : null}
      <Body>{order.status.replace('_', ' ')} · ${(order.totalCents / 100).toFixed(2)}</Body>
      <Button label="Add to calendar" variant="secondary" onPress={() => void addOrderReminder(order, isDemo)} />
      {upcoming && (reschedulable || cancellable) ? (
        <View style={styles.orderActions}>
          {reschedulable ? <Button label="Reschedule one week" variant="secondary" loading={busy === 'reschedule'} style={styles.orderAction} onPress={() => void runOrderAction('reschedule', setBusy, onReschedule)} /> : null}
          {cancellable ? <Button label="Cancel" variant="secondary" loading={busy === 'cancel'} style={styles.orderAction} onPress={() => confirmCancellation(setBusy, onCancel)} /> : null}
        </View>
      ) : order.status === 'picked_up' ? (
        <>
          <Button label={reviewing ? 'Close review' : 'Rate this order'} variant="secondary" onPress={() => setReviewing((current) => !current)} />
          {reviewing ? (
            <View style={styles.reviewForm}>
              <View accessibilityRole="radiogroup" style={styles.ratingRow}>
                {[1, 2, 3, 4, 5].map((value) => (
                  <Pressable key={value} accessibilityRole="radio" {...choiceState(rating === value)} onPress={() => setRating(value)} style={[styles.ratingButton, rating === value && styles.ratingButtonActive]}>
                    <Text style={[styles.ratingText, rating === value && styles.ratingTextActive]}>{value}</Text>
                  </Pressable>
                ))}
              </View>
              <Field label="Review note" value={note} multiline onChangeText={setNote} />
              <Button label="Save review" loading={busy === 'review'} onPress={() => void saveVisitReview(order.id, rating, note, isDemo, setBusy, onReviewed, demo.reviewOrder)} />
            </View>
          ) : null}
        </>
      ) : null}
    </Card>
  );
}

/** One live order: what it was, where it stands, what it cost. */
export function OrderTrackingCard({ order }: { order: PortalOrder }) {
  const styles = useInformationStyles();
  const tracking = trackingView(order.status);
  const active = tracking.activeIndex >= 0 && order.status !== 'picked_up';
  const statusLine = tracking.failed
    ? (tracking.failed === 'cancelled' ? 'Cancelled' : 'Refunded')
    : tracking.steps[Math.max(tracking.activeIndex, 0)]?.title ?? 'Order received';
  return (
    <Card style={styles.detailCard}>
      <Text style={styles.detailTitle}>{order.summary}</Text>
      {packRecipeLines(order).map((recipe, index) => (
        <Body key={`${order.id}-pack-${index}`} muted>{recipe}</Body>
      ))}
      <Body muted>{formatOrderDate(order.scheduledFor ?? order.placedAt)}</Body>
      <Body>{statusLine} · {formatMoney(order.totalCents)}</Body>
      {active ? <Body muted>{tracking.steps[tracking.activeIndex]?.detail ?? ''}</Body> : null}
      {order.note ? <Body muted>“{order.note}”</Body> : null}
    </Card>
  );
}

function packRecipeLines(order: PortalOrder): string[] {
  return order.lines.flatMap((line) => line.packContents && line.packContents.length > 0
    ? [`Inside each ${line.name}: ${line.packContents.map((content) => `${content.quantity}× ${content.name}`).join(' · ')}`]
    : []);
}

function formatOrderDate(value: string) {
  return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

async function runOrderAction(
  action: string,
  setBusy: (value: string | null) => void,
  run: () => Promise<void>,
) {
  setBusy(action);
  try {
    await run();
    Alert.alert('Order updated', action === 'cancel' ? 'Your order was cancelled.' : 'Your new time is confirmed.');
  } catch (error) {
    Alert.alert('Order not updated', error instanceof Error ? error.message : 'Try again later.');
  } finally {
    setBusy(null);
  }
}

function confirmCancellation(setBusy: (value: string | null) => void, onCancel: () => Promise<void>) {
  Alert.alert('Cancel this order?', 'Your cancellation policy may still apply.', [
    { text: 'Keep order', style: 'cancel' },
    { text: 'Cancel order', style: 'destructive', onPress: () => void runOrderAction('cancel', setBusy, onCancel) },
  ]);
}

async function addOrderReminder(order: PortalOrder, isDemo: boolean) {
  try {
    const result = await addOrderToCalendar(
      { summary: order.summary, durationMin: 15 },
      order.scheduledFor ?? order.placedAt,
      isDemo,
      Constants.appOwnership,
    );
    Alert.alert(result.simulated ? 'Calendar preview' : 'Added to calendar', result.message);
  } catch (error) {
    Alert.alert('Calendar unavailable', error instanceof Error ? error.message : 'Try again later.');
  }
}

async function saveVisitReview(
  orderId: string, rating: number, note: string, isDemo: boolean,
  setBusy: (value: string | null) => void, onReviewed: () => Promise<void>,
  saveDemoReview: (orderId: string, rating: number, note: string) => void,
) {
  setBusy('review');
  try {
    if (isDemo) saveDemoReview(orderId, rating, note);
    else {
      await mobileApi.reviewOrder(orderId, rating, note, requestKey('order-review'));
      await onReviewed();
    }
    Alert.alert('Review saved', 'Thank you for sharing your experience.');
  } catch (error) {
    Alert.alert('Review not saved', error instanceof Error ? error.message : 'Try again later.');
  } finally {
    setBusy(null);
  }
}
