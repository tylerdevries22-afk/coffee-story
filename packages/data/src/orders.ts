import type { SupabaseClient } from '@supabase/supabase-js';

import { BOARD_STATUSES, type OrderRow } from '@platform/schema';

/**
 * The operator board's working set: everything at the location that needs
 * hands, oldest first, plus the scheduled lane's future pickups. RLS scopes
 * this to locations in the caller's claims.
 */
export async function fetchActiveLocationOrders(
  client: SupabaseClient,
  locationId: string,
): Promise<OrderRow[]> {
  const result = await client
    .from('orders')
    .select('*')
    .eq('location_id', locationId)
    .in('status', [...BOARD_STATUSES])
    .order('created_at')
    .returns<OrderRow[]>();
  if (result.error) throw new Error(`fetchActiveLocationOrders: ${result.error.message}`);
  return result.data ?? [];
}

export type CustomerOrders = {
  active: OrderRow[];
  past: OrderRow[];
};

/** A guest's own orders, split the way the Orders screen presents them. */
export async function fetchCustomerOrders(
  client: SupabaseClient,
  customerId: string,
  limit = 50,
): Promise<CustomerOrders> {
  const result = await client
    .from('orders')
    .select('*')
    .eq('customer_id', customerId)
    .order('created_at', { ascending: false })
    .limit(limit)
    .returns<OrderRow[]>();
  if (result.error) throw new Error(`fetchCustomerOrders: ${result.error.message}`);
  const rows = result.data ?? [];
  const activeStatuses = new Set<string>(['created', 'paid', 'in_progress', 'ready']);
  return {
    active: rows.filter((row) => activeStatuses.has(row.status)),
    past: rows.filter((row) => !activeStatuses.has(row.status)),
  };
}
