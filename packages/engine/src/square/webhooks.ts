/**
 * Square webhook intake: signature verification and the mapping from
 * Square's event types onto rule 2's order_events rows.
 *
 * Verification is Square's scheme: HMAC-SHA256 over notification_url + raw
 * body with the subscription's signature key, base64, compared in constant
 * time against the x-square-hmacsha256-signature header.
 *
 * Idempotency is not handled here: the caller inserts with the event id into
 * order_events.square_event_id (UNIQUE) and ON CONFLICT DO NOTHING -- a
 * replay dies at the constraint, never in application logic.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

import type { OrderStatus } from '@platform/schema';

import { squareAppFeeCents, squareUsdCents } from './payment-receipt';

export function verifySquareSignature(
  signatureKey: string,
  notificationUrl: string,
  rawBody: string,
  signatureHeader: string | null,
): boolean {
  if (!signatureHeader) return false;
  const expected = createHmac('sha256', signatureKey).update(notificationUrl + rawBody).digest();
  let provided: Buffer;
  try {
    provided = Buffer.from(signatureHeader, 'base64');
  } catch {
    return false;
  }
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}

export type SquareEvent = {
  event_id?: string;
  type?: string;
  data?: {
    object?: {
      payment?: {
        id?: string; status?: string; order_id?: string; location_id?: string;
        total_money?: { amount?: number; currency?: string };
        app_fee_money?: { amount?: number; currency?: string };
      };
      refund?: {
        id?: string;
        status?: string;
        payment_id?: string;
        amount_money?: { amount?: number; currency?: string };
      };
      order?: { id?: string; state?: string };
    };
  };
};

export type MappedEvent = {
  squareEventId: string;
  /** The rule-2 state this event asserts, or null when it moves nothing. */
  orderStatus: OrderStatus | null;
  squareOrderId: string | null;
  squarePaymentId: string | null;
  squareLocationId: string | null;
  /** The underlying refund id, stable across Square delivery event ids. */
  squareRefundId: string | null;
  /**
   * What a refund actually returned, in cents. Square sends it and the
   * platform used to drop it, then reversed loyalty as though every refund
   * were the whole order — a $2 courtesy refund wiped a $50 order's points.
   */
  refundedCents: number | null;
  /** Actual fee collected by this application; absent Square fees mean zero. */
  settledFeeCents?: number;
  /** Provider-confirmed total collected for a completed payment. */
  settledGrossCents?: number;
  kind: 'payment' | 'refund' | 'order' | 'ignored';
};

/**
 * payment COMPLETED -> paid; refund COMPLETED -> refunded; order CANCELED ->
 * cancelled. Everything else (APPROVED, PENDING, FAILED refunds, unrelated
 * event types) is recorded as moving nothing -- the truth for those lives in
 * Square until a terminal state lands.
 */
export function mapSquareEvent(event: SquareEvent): MappedEvent | null {
  if (!event || typeof event !== 'object') return null;
  const id = event.event_id;
  if (!id) return null;
  const object = event.data?.object ?? {};

  if (event.type === 'payment.updated' && object.payment) {
    // Missing app_fee_money means no fee; malformed money is rejected.
    const settledFeeCents = squareAppFeeCents(object.payment.app_fee_money);
    if (settledFeeCents === null) return null;
    const completed = object.payment.status === 'COMPLETED';
    const settledGrossCents = completed ? squareUsdCents(object.payment.total_money) : undefined;
    if (completed && (!object.payment.id || !object.payment.order_id
      || !object.payment.location_id || settledGrossCents === null)) return null;
    return {
      settledFeeCents, settledGrossCents: settledGrossCents ?? undefined,
      squareEventId: id,
      orderStatus: completed ? 'paid' : null,
      squareOrderId: object.payment.order_id ?? null,
      squarePaymentId: object.payment.id ?? null,
      squareLocationId: object.payment.location_id ?? null,
      squareRefundId: null,
      refundedCents: null,
      kind: 'payment',
    };
  }
  if (event.type === 'refund.updated' && object.refund) {
    return {
      squareEventId: id,
      orderStatus: object.refund.status === 'COMPLETED' ? 'refunded' : null,
      squareOrderId: null,
      squarePaymentId: object.refund.payment_id ?? null,
      squareLocationId: null,
      squareRefundId: object.refund.id ?? null,
      refundedCents: typeof object.refund.amount_money?.amount === 'number'
        ? object.refund.amount_money.amount
        : null,
      kind: 'refund',
    };
  }
  if (event.type === 'order.updated' && object.order) {
    return {
      squareEventId: id,
      orderStatus: object.order.state === 'CANCELED' ? 'cancelled' : null,
      squareOrderId: object.order.id ?? null,
      squarePaymentId: null,
      squareLocationId: null,
      squareRefundId: null,
      refundedCents: null,
      kind: 'order',
    };
  }
  return {
    squareEventId: id,
    orderStatus: null,
    squareOrderId: null,
    squarePaymentId: null,
    squareLocationId: null,
    squareRefundId: null,
    refundedCents: null,
    kind: 'ignored',
  };
}
