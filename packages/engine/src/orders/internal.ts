/**
 * Row shapes and result plumbing shared by the order modules. Nothing here
 * is public API: orders.ts re-exports only the modules' public surface.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

import type { MenuItemPricing } from '../menu-pricing';

import { OrderError, type CreateOrderInput, type CreateOrderResult } from './types';

export type ExistingOrder = {
  id: string;
  status: string;
  subtotal_cents: number;
  tax_cents: number;
  tip_cents: number;
  total_cents: number;
  /** Assigned by the app.assign_daily_number trigger, so it is only ever read. */
  daily_number: number | null;
};

export type OrderMenuItem = MenuItemPricing & {
  id: string;
  menu_id: string;
  pack_size: number | null;
  choice_source: 'lineup' | 'static' | null;
  pack_choice_slugs: string[];
};

export type SnapshotLine = {
  name: string;
  quantity: number;
  unit_price_cents: number;
  options: readonly string[];
  pack_contents?: readonly { item_slug: string; name: string; quantity: number }[];
};

export function asResult(row: ExistingOrder, replayed: boolean): CreateOrderResult {
  return {
    orderId: row.id,
    status: row.status,
    subtotalCents: row.subtotal_cents,
    taxCents: row.tax_cents,
    tipCents: row.tip_cents,
    totalCents: row.total_cents,
    dailyNumber: row.daily_number,
    replayed,
  };
}

export function committedResult(value: unknown): CreateOrderResult {
  const payload = value as { order?: Partial<ExistingOrder>; replayed?: unknown } | null;
  const row = payload?.order;
  if (!row || typeof row.id !== 'string' || typeof row.status !== 'string'
    || typeof row.subtotal_cents !== 'number' || !Number.isInteger(row.subtotal_cents)
    || typeof row.tax_cents !== 'number' || !Number.isInteger(row.tax_cents)
    || typeof row.tip_cents !== 'number' || !Number.isInteger(row.tip_cents)
    || typeof row.total_cents !== 'number' || !Number.isInteger(row.total_cents)
    || (row.daily_number !== null
      && (typeof row.daily_number !== 'number' || !Number.isInteger(row.daily_number)))
    || typeof payload?.replayed !== 'boolean') {
    throw new Error('commit_order returned an invalid result.');
  }
  return asResult(row as ExistingOrder, payload.replayed);
}

type OrderRpcError = { code?: string; message: string };

export function throwOrderRpcError(error: OrderRpcError): never {
  if (error.code === '22023' && /idempotency key was already used/i.test(error.message)) {
    throw new OrderError('idempotency_conflict',
      'That Idempotency-Key was already used for a different order request.');
  }
  throw error;
}

export async function resolveOrderReplay(
  db: SupabaseClient,
  input: Pick<CreateOrderInput, 'brandId' | 'clientKey'>,
  requestFingerprint: string,
): Promise<CreateOrderResult | null> {
  const replay = await db.rpc('resolve_order_replay', {
    p_brand_id: input.brandId,
    p_client_key: input.clientKey,
    p_request_fingerprint: requestFingerprint,
  });
  if (replay.error) throwOrderRpcError(replay.error);
  return replay.data === null ? null : committedResult(replay.data);
}
