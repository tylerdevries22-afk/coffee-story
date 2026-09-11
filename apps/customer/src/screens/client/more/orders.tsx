import { useEffect, useState } from 'react';

import { CollapsingScreen } from '@/components/collapsing-screen';
import { Body, Button, Card, Segmented } from '@/components/ui';
import { requestKey } from '@platform/domain';
import { isGuestCancellableDemoOrder, isUpcomingDemoOrder } from '@/features/order-history';
import { mobileApi } from '@/lib/mobile-api';
import { useAuth } from '@/state/auth-context';
import { useDemo } from '@/state/demo-context';

import { OrderTrackingCard, UpcomingOrderCard } from './order-cards';

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
        {shown.map((entry) => <OrderTrackingCard key={entry.id} order={entry} />)}
        {!shown.length ? (
          <Card><Body muted>{tab === 'Upcoming' ? 'No orders in progress.' : 'No past orders yet.'}</Body></Card>
        ) : null}
        <Button label="Start an order" onPress={onBook} />
      </CollapsingScreen>
    );
  }
  const orders = portal.orders.filter((order) => (
    tab === 'Upcoming'
      ? isUpcomingDemoOrder(order, referenceTime)
      : !isUpcomingDemoOrder(order, referenceTime)
  ));

  return (
    <CollapsingScreen title="Orders" eyebrow="My account" onBack={onBack}>
      <Segmented options={['Upcoming', 'Past'] as const} value={tab} onChange={setTab} />
      {orders.map((order) => (
        <UpcomingOrderCard
          key={order.id}
          order={order}
          isDemo={isDemo}
          upcoming={isUpcomingDemoOrder(order, referenceTime)}
          cancellable={isGuestCancellableDemoOrder(order)}
          reschedulable={!order.demoSynced}
          onCancel={async () => {
            if (isDemo) await demo.cancelOrder(order.id);
            else {
              await mobileApi.cancelOrder(order.id, requestKey('order-cancel'));
              await refresh();
            }
          }}
          onReschedule={async () => {
            const next = new Date(order.scheduledFor ?? order.placedAt);
            next.setDate(next.getDate() + 7);
            if (isDemo) {
              demo.rescheduleOrder(order.id, next.toISOString());
            } else {
              await mobileApi.rescheduleOrder(order.id, next.toISOString(), requestKey('order-reschedule'));
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
