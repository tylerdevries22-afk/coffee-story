import type { SupabaseClient } from '@supabase/supabase-js';

import type { OrderRow, OrderStatus } from '@platform/schema';
import { abortRead, readWithRetry } from './read-retry';

/**
 * Live order tracking: one channel per order, reporting the order's status
 * as the database holds it. RLS applies to replicated rows, so a guest only
 * receives changes for orders their JWT can read. Falls back silently —
 * tracking screens also refetch on focus.
 *
 * It follows the `orders` row rather than `order_events` inserts, which is
 * the difference between "what the order is" and "what was just recorded
 * about it". The state-machine trigger records an idempotent re-assertion —
 * a second Square delivery for the same payment, a barista asserting paid at
 * handoff — by inserting the event and moving nothing. Reading the event
 * type walked the guest's screen backwards from "Ready for pickup" to
 * "Paid" for something that changed nothing at all.
 *
 * Seeds with a read, so the screen opens on the truth instead of a guess.
 */
export function subscribeToOrderStatus(
  client: SupabaseClient | null,
  orderId: string,
  onStatus: (status: OrderStatus) => void,
): () => void {
  if (!client) return () => {};
  let live = true;
  void readWithRetry('subscribeToOrderStatus seed', (signal) => abortRead(client
    .from('orders')
    .select('status')
    .eq('id', orderId), signal)
    .maybeSingle<{ status: OrderStatus }>())
    .then((data) => {
      if (live && data?.status) onStatus(data.status);
    });
  const channel = client
    .channel(`order-${orderId}`)
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'orders', filter: `id=eq.${orderId}` },
      (payload) => {
        const status = (payload.new as { status?: string } | null)?.status;
        if (typeof status === 'string') onStatus(status as OrderStatus);
      },
    )
    .subscribe();
  return () => {
    live = false;
    void client.removeChannel(channel);
  };
}

export type LocationOrdersEvent =
  | { kind: 'order'; order: OrderRow }
  | { kind: 'status'; orderId: string; status: OrderStatus };

/**
 * The operator board's feed: order inserts and updates at one location.
 * `replica identity full` (0013) puts the whole row in the payload, so the
 * board upserts rows without a refetch; a periodic reconcile still guards
 * against missed messages.
 */
export function subscribeToLocationOrders(
  client: SupabaseClient | null,
  locationId: string,
  onEvent: (event: LocationOrdersEvent) => void,
): () => void {
  if (!client) return () => {};
  const channel = client
    .channel(`location-orders-${locationId}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'orders', filter: `location_id=eq.${locationId}` },
      (payload) => {
        const row = payload.new as OrderRow | null;
        if (row && typeof row.id === 'string') onEvent({ kind: 'order', order: row });
      },
    )
    .subscribe();
  return () => {
    void client.removeChannel(channel);
  };
}
