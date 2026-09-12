import {
  squareApplicationFeeCapCents, squareCardFundingAmounts, type SquareConfig,
} from '@platform/engine';
import type { SupabaseClient } from '@supabase/supabase-js';

import { log } from './log';
import { inspectDueSquareCard } from './square-card-inspection';
import { recoverDueSquareCard } from './square-card-recovery';
import type {
  CardExpiryEvidence, CardInspection, CardMaintenanceDeps, DueSquareCard,
  SquareCardExpirySummary,
} from './square-card-maintenance-types';

export type { DueSquareCard, SquareCardExpirySummary } from './square-card-maintenance-types';

const CLAIM_LIMIT = 50;
const CONCURRENCY = 10;

type DueQuote = {
  order_id: string;
  brand_id: string;
  location_id: string;
  expires_at: string;
  claim_generation: string;
  square_order_id: string | null;
  square_payment_id: string | null;
  gross_cents: number;
  quoted_fee_cents: number;
  quoted_fee_bps_applied: number;
};

type CardOrder = {
  id: string; brand_id: string; location_id: string; status: string; tender_type: string;
  total_cents: number; tip_cents: number; stored_value_applied_cents: number;
  square_order_id: string | null; square_payment_id: string | null;
};

type Connection = {
  brand_id: string;
  location_id: string;
  square_location_id: string | null;
  access_token_encrypted: string;
};

function nullableId(value: unknown): boolean {
  return value === null || (typeof value === 'string' && value !== '');
}

function validClaims(value: unknown): value is DueQuote[] {
  return Array.isArray(value) && value.every((row) => {
    if (!row || typeof row !== 'object') return false;
    const item = row as Record<string, unknown>;
    const gross = item.gross_cents;
    const fee = item.quoted_fee_cents;
    const cap = Number.isSafeInteger(gross) && (gross as number) > 0
      ? squareApplicationFeeCapCents(gross as number) : -1;
    return ['order_id', 'brand_id', 'location_id', 'expires_at', 'claim_generation']
      .every((key) => typeof item[key] === 'string' && item[key] !== '')
      && nullableId(item.square_order_id) && nullableId(item.square_payment_id)
      && Number.isSafeInteger(gross) && (gross as number) > 0
      && Number.isSafeInteger(fee) && (fee as number) >= 0 && (fee as number) <= cap
      && Number.isSafeInteger(item.quoted_fee_bps_applied)
      && (item.quoted_fee_bps_applied as number) >= 0
      && (item.quoted_fee_bps_applied as number) <= 9_000;
  });
}

function providerOrderTotal(grossCents: number, tipCents: number): number | null {
  try { return squareCardFundingAmounts(grossCents, tipCents).providerOrderTotalCents; }
  catch { return null; }
}

async function loadDueCards(db: SupabaseClient, now: Date): Promise<DueSquareCard[]> {
  const claimed = await db.rpc('claim_due_square_card_quotes', {
    p_now: now.toISOString(), p_limit: CLAIM_LIMIT,
  });
  if (claimed.error) throw claimed.error;
  if (!validClaims(claimed.data)) throw new Error('Invalid Square card claim result.');
  if (claimed.data.length === 0) return [];
  const orderIds = claimed.data.map((row) => row.order_id);
  const locationIds = [...new Set(claimed.data.map((row) => row.location_id))];
  const [orders, connections] = await Promise.all([
    db.from('orders')
      .select('id, brand_id, location_id, status, tender_type, total_cents, tip_cents, stored_value_applied_cents, square_order_id, square_payment_id')
      .in('id', orderIds).returns<CardOrder[]>(),
    db.from('square_connections')
      .select('brand_id, location_id, square_location_id, access_token_encrypted')
      .in('location_id', locationIds).returns<Connection[]>(),
  ]);
  if (orders.error) throw orders.error;
  if (connections.error) throw connections.error;
  const orderById = new Map((orders.data ?? []).map((row) => [row.id, row]));
  const connectionByTenant = new Map((connections.data ?? [])
    .map((row) => [`${row.brand_id}:${row.location_id}`, row]));
  return claimed.data.map((claim) => {
    const order = orderById.get(claim.order_id);
    const connection = connectionByTenant.get(`${claim.brand_id}:${claim.location_id}`);
    const gross = order ? order.total_cents - order.stored_value_applied_cents : null;
    const orderTotal = order && gross !== null ? providerOrderTotal(gross, order.tip_cents) : null;
    const valid = (order?.status === 'created' || order?.status === 'cancelled')
      && order.tender_type === 'square_card'
      && order.brand_id === claim.brand_id && order.location_id === claim.location_id
      && order.square_order_id === claim.square_order_id
      && order.square_payment_id === claim.square_payment_id
      && gross === claim.gross_cents && orderTotal !== null;
    return {
      orderId: claim.order_id, brandId: claim.brand_id, locationId: claim.location_id,
      expiresAt: claim.expires_at, claimGeneration: claim.claim_generation,
      squareOrderId: claim.square_order_id, squarePaymentId: claim.square_payment_id,
      squareLocationId: connection?.square_location_id ?? null,
      grossCents: valid ? claim.gross_cents : null,
      providerOrderTotalCents: valid ? orderTotal : null,
      expectedFeeCents: valid ? claim.quoted_fee_cents : null,
      feeBpsApplied: valid ? claim.quoted_fee_bps_applied : null,
      accessTokenEncrypted: connection?.access_token_encrypted ?? null, valid,
    };
  });
}

async function reconcile(
  db: SupabaseClient, row: DueSquareCard, result: CardInspection,
): Promise<boolean> {
  if (result.kind !== 'payment') throw new Error('Payment result required.');
  const settled = await db.rpc('record_square_payment_settlement', {
    target_order: row.orderId, square_event: `reconcile:${result.paymentId}`,
    square_order: row.squareOrderId,
    square_payment: result.paymentId, settled_fee_cents: result.feeCents,
    square_event_type: 'payment.reconciled',
  });
  if (settled.error) throw settled.error;
  return true;
}

async function expire(
  db: SupabaseClient, row: DueSquareCard, result: CardExpiryEvidence,
): Promise<boolean> {
  const expired = await db.rpc('expire_square_card_quote', {
    p_order_id: row.orderId, p_claim_generation: row.claimGeneration,
    p_square_order_id: result.squareOrderId,
    p_provider_order_version: result.providerOrderVersion,
    p_provider_order_state: result.providerOrderState,
    p_square_payment_id: result.squarePaymentId,
    p_provider_payment_state: result.providerPaymentState,
  });
  if (expired.error) throw expired.error;
  return expired.data === true;
}

/** Reconcile settled attempts and release only provider-terminal ones. */
export async function expireDueSquareCardQuotes(
  db: SupabaseClient, square: SquareConfig, now: Date, deps: CardMaintenanceDeps = {},
): Promise<SquareCardExpirySummary> {
  const summary: SquareCardExpirySummary = {
    scanned: 0, reconciled: 0, expired: 0, failed: 0, stale: 0, scanFailed: false,
  };
  let rows: DueSquareCard[];
  try { rows = await (deps.load ?? loadDueCards)(db, now); }
  catch { log.error('square.card_expiry_scan_failed', {}); summary.scanFailed = true; return summary; }
  summary.scanned = rows.length;
  for (let offset = 0; offset < rows.length; offset += CONCURRENCY) {
    const results = await Promise.all(rows.slice(offset, offset + CONCURRENCY).map(async (row) => {
      let recovered: DueSquareCard;
      let inspected: CardInspection;
      try {
        recovered = await (deps.recover ?? recoverDueSquareCard)(db, square, row);
        inspected = await (deps.inspect ?? inspectDueSquareCard)(square, recovered);
      }
      catch { return 'failed' as const; }
      try {
        const changed = inspected.kind === 'payment'
          ? await (deps.reconcile ?? reconcile)(db, recovered, inspected)
          : await (deps.expire ?? expire)(db, recovered, inspected);
        return changed ? inspected.kind === 'payment' ? 'reconciled' as const : 'expired' as const
          : 'stale' as const;
      } catch { return 'failed' as const; }
    }));
    for (const result of results) summary[result] += 1;
  }
  return summary;
}
