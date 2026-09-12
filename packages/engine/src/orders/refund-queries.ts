/**
 * Refund event lookups and the webhook-winner claim shared by the refund
 * writer. Internal to the order modules; not part of the public API.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

import { replayForClaimedRefund, type RefundEventRecord } from '../refunds';

import { OrderError } from './types';

/**
 * What has already gone back on this order.
 *
 * Keyed on typed processor identity rather than event type: a partial refund
 * records itself without moving the order (see below), so it does not carry
 * type 'refunded' and a type filter would miss exactly what this sum counts.
 */
export async function refundEventsFor(db: SupabaseClient, orderId: string): Promise<RefundEventRecord[]> {
  const { data, error } = await db
    .from('order_events')
    .select('brand_id, order_id, square_refund_id, refund_cents, refund_request_key, snapshot')
    .eq('order_id', orderId)
    .returns<RefundEventRecord[]>();
  if (error) throw error;
  return data ?? [];
}

export async function refundEventByRequestKey(
  db: SupabaseClient,
  brandId: string,
  requestKey: string,
): Promise<RefundEventRecord | null> {
  const result = await db
    .from('order_events')
    .select('brand_id, order_id, square_refund_id, refund_cents, refund_request_key, snapshot')
    .eq('brand_id', brandId)
    .eq('refund_request_key', requestKey)
    .maybeSingle<RefundEventRecord>();
  if (result.error) throw result.error;
  return result.data;
}

export async function refundEventBySquareId(
  db: SupabaseClient,
  refundId: string,
): Promise<RefundEventRecord | null> {
  const result = await db
    .from('order_events')
    .select('brand_id, order_id, square_refund_id, refund_cents, refund_request_key, snapshot')
    .eq('square_refund_id', refundId)
    .maybeSingle<RefundEventRecord>();
  if (result.error) throw result.error;
  return result.data;
}

export type OrderRefundClaim = {
  brand_id: string;
  status: string;
  total_cents: number;
  stored_value_applied_cents: number;
  square_payment_id: string | null;
  already_refunded_cents: number;
};

/**
 * The locked read that feeds `refundable`. `begin_order_refund` does the
 * order's SELECT ... FOR UPDATE and the already-refunded sum inside one
 * advisory-locked transaction, AND stamps a durable claim on the order row
 * -- see the migration's comment for why the claim, not just the lock, is
 * what actually serializes two concurrent attempts (a PostgREST RPC call is
 * its own transaction, so a lock alone would release before Square is ever
 * called). A `22023` here means a different attempt already holds the claim.
 */
export async function beginOrderRefund(
  db: SupabaseClient,
  orderId: string,
  requestKey: string,
): Promise<OrderRefundClaim | null> {
  const result = await db.rpc('begin_order_refund', { p_order_id: orderId, p_request_key: requestKey });
  if (result.error) {
    if (result.error.code === '22023') {
      throw new OrderError('refund_unavailable',
        'Another refund attempt for this order is already in progress. Try again in a moment.');
    }
    throw result.error;
  }
  const rows = (result.data ?? []) as OrderRefundClaim[];
  return rows[0] ?? null;
}

/**
 * Releases the claim `beginOrderRefund` took, so the order is refundable
 * again. Never throws: this runs after Square has already answered (or the
 * attempt never got that far), and a network blip on the release call must
 * not turn a completed refund into an error the client retries. The claim's
 * own two-minute TTL (in the migration) is what bounds a release that never
 * arrives.
 */
export async function endOrderRefund(db: SupabaseClient, orderId: string, requestKey: string): Promise<void> {
  try {
    await db.rpc('end_order_refund', { p_order_id: orderId, p_request_key: requestKey });
  } catch {
    // Self-heals via begin_order_refund's TTL check on the next attempt.
  }
}

export async function claimWebhookRefundWinner(
  db: SupabaseClient,
  input: {
    brandId: string;
    orderId: string;
    refundId: string;
    refundCents: number;
    requestKey: string;
    requestedAmount: number | 'full';
  },
) {
  const claimed = await db.rpc('claim_refund_request', {
    p_brand_id: input.brandId,
    p_order_id: input.orderId,
    p_square_refund_id: input.refundId,
    p_refund_cents: input.refundCents,
    p_refund_request_key: input.requestKey,
    p_requested_amount: input.requestedAmount,
  });
  if (claimed.error) {
    if (claimed.error.code === '22023') {
      throw new OrderError('invalid_request',
        'That idempotency key belongs to a different refund attempt.');
    }
    throw claimed.error;
  }
  const replay = claimed.data
    ? replayForClaimedRefund(claimed.data as RefundEventRecord, input)
    : null;
  if (!replay) throw new Error('claim_refund_request returned an invalid refund event.');
  return replay;
}
