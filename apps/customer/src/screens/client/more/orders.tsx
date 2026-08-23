import Constants from 'expo-constants';
import { useEffect, useState } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';

import { CollapsingScreen } from '@/components/collapsing-screen';
import { Body, Button, Card, Segmented } from '@/components/ui';
import { requestKey } from '@/features/order/request-key';
import { formatMoney } from '@/features/money';
import { trackingView } from '@/features/tracking';
import { mobileApi } from '@/lib/mobile-api';
import { addOrderToCalendar } from '@/lib/native-adapters';
import { useAuth } from '@/state/auth-context';
import { useDemo } from '@/state/demo-context';
import type { PortalOrder } from '@/types/domain';
import { choiceState } from '@/lib/a11y-state';

import { styles } from './information-page';
import { Field } from './profile-and-preferences';

const ACTIVE_ORDER_STATUSES = new Set(['created', 'paid', 'in_progress', 'ready']);

export function Orders({ onBack, onBook }: { onBack: () => void; onBook: () => void }) {
  const { portal, isDemo, refresh } = useAuth();
  const demo = useDemo();
  const [tab, setTab] = useState<'Upcoming' | 'Past'>('Upcoming');
  const [referenceTime] = useState(() => Date.now());

  // Live orders move under the operator's hands; re-read on entry so the
  // list reflects the shop, not the last bootstrap.
  useEffect(() => {
    if (!isDemo) void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on entry
  }, []);

  if (!isDemo) {
    const orders = portal.orders ?? [];
    const shown = orders.filter((entry) => (
      tab === 'Upcoming' ? ACTIVE_ORDER_STATUSES.has(entry.status) : !ACTIVE_ORDER_STATUSES.has(entry.status)
    ));
    return (
      <CollapsingScreen title="Orders" eyebrow="My account" onBack={onBack}>
        <Segmented options={['Upcoming', 'Past'] as const} value={tab} onChange={setTab} />
        {shown.map((entry) => <OrderCard key={entry.id} order={entry} />)}
        {!shown.length ? (
          <Card><Body muted>{tab === 'Upcoming' ? 'No orders in progress.' : 'No past orders yet.'}</Body></Card>
        ) : null}
        <Button label="Start an order" onPress={onBook} />
      </CollapsingScreen>
    );
  }
  const orders = portal.orders.filter((order) => (
    tab === 'Upcoming'
      ? new Date(order.placedAt).getTime() >= referenceTime && order.status !== 'cancelled'
      : new Date(order.placedAt).getTime() < referenceTime || ['picked_up', 'cancelled', 'cancelled'].includes(order.status)
  ));

  return (
    <CollapsingScreen title="Orders" eyebrow="My account" onBack={onBack}>
      <Segmented options={['Upcoming', 'Past'] as const} value={tab} onChange={setTab} />
      {orders.map((order) => (
        <AppointmentCard
          key={order.id}
          order={order}
          isDemo={isDemo}
          upcoming={new Date(order.placedAt).getTime() >= referenceTime
            && order.status !== 'cancelled'}
          onCancel={async () => {
            if (isDemo) demo.cancelAppointment(order.id);
            else {
              await mobileApi.cancelAppointment(order.id, requestKey('order-cancel'));
              await refresh();
            }
          }}
          onReschedule={async () => {
            const next = new Date(order.placedAt);
            next.setDate(next.getDate() + 7);
            if (isDemo) {
              demo.rescheduleAppointment(order.id, next.toISOString());
            } else {
              await mobileApi.rescheduleAppointment(order.id, next.toISOString(), requestKey('order-reschedule'));
              await refresh();
            }
          }}
          onReviewed={refresh}
        />
      ))}
      {!orders.length ? <Card><Body muted>No {tab.toLowerCase()} orders.</Body></Card> : null}
      <Button label="Book a order" onPress={onBook} />
    </CollapsingScreen>
  );
}

function AppointmentCard({
  order,
  isDemo,
  upcoming,
  onCancel,
  onReschedule,
  onReviewed,
}: {
  order: PortalOrder;
  isDemo: boolean;
  upcoming: boolean;
  onCancel: () => Promise<void>;
  onReschedule: () => Promise<void>;
  onReviewed: () => Promise<void>;
}) {
  const demo = useDemo();
  const [reviewing, setReviewing] = useState(false);
  const [rating, setRating] = useState(5);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  return (
    <Card style={styles.detailCard}>
      <Text style={styles.detailTitle}>{order.summary}</Text>
      <Body muted>{formatOrderDate(order.placedAt)}</Body>
      {order.locationLabel ? <Body>{order.locationLabel} · {order.locationDetail}</Body> : null}
      <Body>{order.status.replace("_", " ")} · ${(order.totalCents / 100).toFixed(2)}</Body>
      <Button label="Add to calendar" variant="secondary" onPress={() => void addOrderReminder(order, isDemo)} />
      {upcoming ? (
        <View style={styles.orderActions}>
          <Button label="Reschedule one week" variant="secondary" loading={busy === 'reschedule'} style={styles.orderAction} onPress={() => void runOrderAction('reschedule', setBusy, onReschedule)} />
          <Button label="Cancel" variant="secondary" loading={busy === 'cancel'} style={styles.orderAction} onPress={() => confirmCancellation(setBusy, onCancel)} />
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
              <Button label="Save review" loading={busy === 'review'} onPress={() => void saveVisitReview(order.id, rating, note, isDemo, setBusy, onReviewed, demo.reviewAppointment)} />
            </View>
          ) : null}
        </>
      ) : null}
    </Card>
  );
}

/** One live order: what it was, where it stands, what it cost. */
function OrderCard({ order }: { order: PortalOrder }) {
  const tracking = trackingView(order.status);
  const active = tracking.activeIndex >= 0 && order.status !== 'picked_up';
  const statusLine = tracking.failed
    ? (tracking.failed === 'cancelled' ? 'Cancelled' : 'Refunded')
    : tracking.steps[Math.max(tracking.activeIndex, 0)]?.title ?? 'Order received';
  return (
    <Card style={styles.detailCard}>
      <Text style={styles.detailTitle}>{order.summary}</Text>
      <Body muted>{formatOrderDate(order.scheduledFor ?? order.placedAt)}</Body>
      <Body>{statusLine} · {formatMoney(order.totalCents)}</Body>
      {active ? (
        <Body muted>
          {tracking.steps[tracking.activeIndex]?.detail ?? ''}
        </Body>
      ) : null}
      {order.note ? <Body muted>“{order.note}”</Body> : null}
    </Card>
  );
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
  appointmentId: string,
  rating: number,
  note: string,
  isDemo: boolean,
  setBusy: (value: string | null) => void,
  onReviewed: () => Promise<void>,
  saveDemoReview: (appointmentId: string, rating: number, note: string) => void,
) {
  setBusy('review');
  try {
    if (isDemo) {
      // Previously the demo branch persisted nothing and fell straight through to
      // the success alert, so a preview user rated a order, was told "Review
      // saved", and found the form blank again on return.
      saveDemoReview(appointmentId, rating, note);
    } else {
      await mobileApi.reviewAppointment(appointmentId, rating, note, requestKey('order-review'));
      await onReviewed();
    }
    Alert.alert('Review saved', 'Thank you for sharing your experience.');
  } catch (error) {
    Alert.alert('Review not saved', error instanceof Error ? error.message : 'Try again later.');
  } finally {
    setBusy(null);
  }
}
