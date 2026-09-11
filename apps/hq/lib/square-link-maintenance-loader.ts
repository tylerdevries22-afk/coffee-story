import { squareApplicationFeeCapCents } from '@platform/engine';
import type { SupabaseClient } from '@supabase/supabase-js';

import type { DueSquareLink } from './square-link-maintenance-types';

const CLAIM_LIMIT = 50;
type DueQuote = {
  order_id: string; brand_id: string; location_id: string; expires_at: string;
  claim_generation: string; square_checkout_url: string | null;
  square_payment_link_id: string | null; square_order_id: string | null;
  gross_cents: number; quoted_fee_cents: number; quoted_fee_bps_applied: number;
};
type LinkOrder = {
  id: string; brand_id: string; location_id: string; status: string; tender_type: string;
  total_cents: number; stored_value_applied_cents: number;
  square_checkout_url: string | null; square_payment_link_id: string | null;
  square_order_id: string | null;
};
type Connection = {
  brand_id: string; location_id: string; square_location_id: string | null;
  access_token_encrypted: string;
};
function nullableId(value: unknown): boolean {
  return value === null || (typeof value === 'string' && value !== '');
}
function validQuotes(value: unknown): value is DueQuote[] {
  return Array.isArray(value) && value.every((row) => {
    if (!row || typeof row !== 'object') return false;
    const item = row as Record<string, unknown>;
    const gross = item.gross_cents;
    const fee = item.quoted_fee_cents;
    const cap = Number.isSafeInteger(gross) && (gross as number) > 0
      ? squareApplicationFeeCapCents(gross as number) : -1;
    return ['order_id', 'brand_id', 'location_id', 'expires_at', 'claim_generation']
      .every((key) => typeof item[key] === 'string' && item[key] !== '')
      && nullableId(item.square_checkout_url) && nullableId(item.square_payment_link_id)
      && nullableId(item.square_order_id)
      && Number.isSafeInteger(gross) && (gross as number) > 0
      && Number.isSafeInteger(fee) && (fee as number) >= 0 && (fee as number) <= cap
      && Number.isSafeInteger(item.quoted_fee_bps_applied)
      && (item.quoted_fee_bps_applied as number) >= 0
      && (item.quoted_fee_bps_applied as number) <= 9_000;
  });
}

/** Lease expired hosted attempts and attach exact tenant/provider configuration. */
export async function loadDueSquareLinks(
  db: SupabaseClient, now: Date,
): Promise<DueSquareLink[]> {
  const quotes = await db.rpc('claim_due_square_checkout_quotes', {
    p_now: now.toISOString(), p_limit: CLAIM_LIMIT,
  });
  if (quotes.error) throw quotes.error;
  if (!validQuotes(quotes.data)) throw new Error('Invalid Square checkout claim result.');
  if (quotes.data.length === 0) return [];
  const orderIds = quotes.data.map((row) => row.order_id);
  const locationIds = [...new Set(quotes.data.map((row) => row.location_id))];
  const [orders, connections] = await Promise.all([
    db.from('orders')
      .select('id, brand_id, location_id, status, tender_type, total_cents, stored_value_applied_cents, square_checkout_url, square_payment_link_id, square_order_id')
      .in('id', orderIds).returns<LinkOrder[]>(),
    db.from('square_connections')
      .select('brand_id, location_id, square_location_id, access_token_encrypted')
      .in('location_id', locationIds).returns<Connection[]>(),
  ]);
  if (orders.error) throw orders.error;
  if (connections.error) throw connections.error;
  const orderById = new Map((orders.data ?? []).map((row) => [row.id, row]));
  const connectionByTenant = new Map((connections.data ?? [])
    .map((row) => [`${row.brand_id}:${row.location_id}`, row]));
  return quotes.data.map((quote) => {
    const order = orderById.get(quote.order_id);
    const connection = connectionByTenant.get(`${quote.brand_id}:${quote.location_id}`);
    const gross = order ? order.total_cents - order.stored_value_applied_cents : null;
    const valid = (order?.status === 'created' || order?.status === 'cancelled')
      && order.tender_type === 'square_link'
      && order.brand_id === quote.brand_id && order.location_id === quote.location_id
      && order.square_checkout_url === quote.square_checkout_url
      && order.square_payment_link_id === quote.square_payment_link_id
      && order.square_order_id === quote.square_order_id && gross === quote.gross_cents;
    return {
      order_id: quote.order_id, brand_id: quote.brand_id, location_id: quote.location_id,
      expires_at: quote.expires_at, claim_generation: quote.claim_generation,
      checkoutUrl: quote.square_checkout_url, paymentLinkId: quote.square_payment_link_id,
      squareOrderId: quote.square_order_id,
      squareLocationId: connection?.square_location_id ?? null,
      accessTokenEncrypted: connection?.access_token_encrypted ?? null,
      grossCents: valid ? quote.gross_cents : null,
      expectedFeeCents: valid ? quote.quoted_fee_cents : null,
      feeBpsApplied: valid ? quote.quoted_fee_bps_applied : null, valid,
    };
  });
}
