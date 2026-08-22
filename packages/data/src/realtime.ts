import type { SupabaseClient } from '@supabase/supabase-js';

import type { OrderRow, OrderStatus } from '@platform/schema';

/**
 * Live order tracking: one channel per order, listening for order_events
 * inserts and reporting the newest status. RLS applies to replicated rows,
 * so a guest only receives events for orders their JWT can read. Falls back
 * silently — tracking screens also refetch on focus.
 *
 * Promoted from the customer app's lib/realtime-orders.ts; the client is a
 * parameter now so the operator app and tests share the identical channel.
 */
export function subscribeToOrderStatus(
  client: SupabaseClient | null,
  orderId: string,
  onStatus: (status: OrderStatus) => void,
): () => void {
  if (!client) return () => {};
  const channel = client
    .channel(`order-${orderId}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'order_events', filter: `order_id=eq.${orderId}` },
      (payload) => {
        const type = (payload.new as { type?: string } | null)?.type;
        if (typeof type === 'string') onStatus(type as OrderStatus);
      },
    )
    .subscribe();
  return () => {
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
