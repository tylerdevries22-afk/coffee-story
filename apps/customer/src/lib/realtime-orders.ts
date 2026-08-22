/**
 * Live order tracking over Supabase Realtime: one channel per order,
 * listening for order_events inserts and reporting the newest status.
 *
 * RLS still applies to the replicated rows, so a guest only ever receives
 * events for orders their JWT can read. Falls back silently -- the tracking
 * screen also refetches on focus, and the demo simulator never comes here.
 */
import type { OrderStatus } from '@platform/schema';

import { supabase } from '@/lib/supabase';

export function subscribeToOrderStatus(
  orderId: string,
  onStatus: (status: OrderStatus) => void,
): () => void {
  if (!supabase) return () => {};
  const channel = supabase
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
    void supabase?.removeChannel(channel);
  };
}
