import type { SupabaseClient } from '@supabase/supabase-js';

import type { OrderRow } from '@platform/schema';

import { readWithRetry, type DataReadOptions } from './read-retry';

/**
 * The operator board's working set: everything at the location that needs
 * hands, oldest first, plus the scheduled lane's future pickups. RLS scopes
 * this to locations in the caller's claims.
 */
export async function fetchActiveLocationOrders(
  client: SupabaseClient,
  locationId: string,
  options: DataReadOptions = {},
): Promise<OrderRow[]> {
  const rows = await readWithRetry('fetchActiveLocationOrders', (signal) => client
    .from('orders')
    .select('*')
    .eq('location_id', locationId)
    // Unpaid Square rows stay private and off the production board. A
    // pay-at-pickup row is actionable: staff must explicitly collect it.
    .or('status.in.(paid,in_progress,ready),and(status.eq.created,tender_type.eq.pay_at_pickup)')
    .order('created_at')
    .abortSignal(signal)
    .returns<OrderRow[]>(), options);
  return rows ?? [];
}

export type LocationOrderStatus = Pick<OrderRow, 'id' | 'status'>;

/**
 * Authoritative status read for queued operator actions, including terminal
 * rows that intentionally disappear from the active board.
 */
export async function fetchLocationOrderStatuses(
  client: SupabaseClient,
  locationId: string,
  orderIds: readonly string[],
  options: DataReadOptions = {},
): Promise<LocationOrderStatus[]> {
  if (orderIds.length === 0) return [];
  const rows = await readWithRetry('fetchLocationOrderStatuses', (signal) => client
    .from('orders')
    .select('id, status')
    .eq('location_id', locationId)
    .in('id', [...new Set(orderIds)])
    .abortSignal(signal)
    .returns<LocationOrderStatus[]>(), options);
  return rows ?? [];
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
