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
