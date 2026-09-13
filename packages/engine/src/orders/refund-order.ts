import type { SupabaseClient } from '@supabase/supabase-js';

import {
  manualRefundEvent,
  replayForRequest,
  replayForSquareRefund,
} from '../refunds';
import { refundSquarePayment, type SquareConfig } from '../square/client';

import { recordFeeRefund, resolveRefundAppFeeCents } from './refund-order-fee';
import {
  beginOrderRefund,
  claimWebhookRefundWinner,
  endOrderRefund,
  refundEventByRequestKey,
  refundEventBySquareId,
} from './refund-queries';
import { OrderError } from './types';

export type RefundDeps = {
  db: SupabaseClient;
  square: SquareConfig;
  locationAccessToken: string;
};

export type RefundInput = {
  orderId: string;
  /** Cents to return, or everything not already returned. */
  amountCents: number | 'full';
  reason: string;
  actorUserId: string | null;
  /**
   * Identifies this refund ATTEMPT. Square deduplicates on it, so a retry
   * after a lost response returns the first refund instead of sending the
   * money twice — and two genuinely separate refunds of equal size must
   * carry different keys, which keying on the amount could never do.
   */
  requestKey: string;
};

/** States a refund may legally follow. Checked before money moves. */
const REFUNDABLE: ReadonlySet<string> = new Set(['paid', 'in_progress', 'ready', 'picked_up', 'refunded']);

/**
 * Money back through Square, then the event that records it. Only a card
 * order can refund here: a pay-at-pickup order never charged a card through
 * the platform, so returning that money happens wherever it was taken, and
 * saying so beats a failure staff cannot act on.
 */
export async function refundOrderPayment(
  deps: RefundDeps,
  input: RefundInput,
): Promise<{ orderId: string; refundId: string; amountCents: number }> {
  const order = await beginOrderRefund(deps.db, input.orderId, input.requestKey);
  if (!order) throw new OrderError('invalid_request', 'That order does not exist.');

  try {
    if (!order.square_payment_id) {
      throw new OrderError('refund_unavailable',
        'This order was not paid by card through the app, so there is nothing to return here — refund it however it was collected.');
    }
    const existingAttempt = await refundEventByRequestKey(deps.db, order.brand_id, input.requestKey);
    const priorAttempt = replayForRequest(existingAttempt ? [existingAttempt] : [], {
      brandId: order.brand_id,
      orderId: input.orderId,
      requestKey: input.requestKey,
      amountCents: input.amountCents,
    });
    if (priorAttempt.outcome === 'match') return priorAttempt.result;
    if (priorAttempt.outcome === 'conflict') {
      throw new OrderError('invalid_request', 'That idempotency key belongs to a different refund attempt.');
    }

    // Checked BEFORE Square is called. Money that moves and then cannot be
    // recorded is the one failure with no clean recovery: the guest has their
    // refund, the platform has no trace of it, and every retry repeats the
    // question. A cancelled order has no legal edge to refunded, so it would
    // have charged and then thrown.
    if (!REFUNDABLE.has(order.status)) {
      throw new OrderError('refund_unavailable',
        `This order is ${order.status}; it cannot be refunded.`);
    }

    const refundable = order.total_cents - order.stored_value_applied_cents - order.already_refunded_cents;
    if (refundable <= 0) {
      throw new OrderError('refund_unavailable', 'This order has already been fully refunded.');
    }
    const amountCents = input.amountCents === 'full' ? refundable : input.amountCents;
    if (!Number.isInteger(amountCents) || amountCents <= 0) {
      throw new OrderError('invalid_request', 'Refund amount must be a whole number of cents.');
    }
    // The cap is what is LEFT, not the order total: three $10 refunds on a $22
    // order each passed a per-call check that never looked at the other two.
    if (amountCents > refundable) {
      throw new OrderError('invalid_request',
        `Only ${refundable} cents are left to refund on this order.`);
    }

    // Resolved before Square is called, so a failed read refuses an action
    // nothing has taken yet rather than orphaning a fee against moved money.
    const appFeeCents = await resolveRefundAppFeeCents(deps.db, input.orderId, amountCents);

    const refund = await refundSquarePayment(deps.square, deps.locationAccessToken, {
      paymentId: order.square_payment_id,
      amountCents,
      appFeeCents,
      // The caller's key, not the amount: two separate $5 refunds are two
      // refunds, and keying on the amount made Square treat the second as a
      // replay of the first — returning $5 while the books recorded $10.
      referenceId: input.requestKey,
      reason: input.reason,
    });
    const refundId = refund.refund?.id;
    if (!refundId) throw new Error('Square returned no refund id.');

    // A refund that does not cover the order leaves it where it was: 'refunded'
    // is terminal, and asserting it for a $2 courtesy refund stranded a $22
    // order the barista still had to hand over, with no legal move left.
    const fullyRefunded = order.already_refunded_cents + amountCents
      >= order.total_cents - order.stored_value_applied_cents;
    const { error: eventError } = await deps.db.from('order_events').insert(manualRefundEvent({
      brandId: order.brand_id,
      orderId: input.orderId,
      // Partial refunds record themselves without moving the order.
      type: fullyRefunded ? 'refunded' : order.status,
      refundId,
      amountCents,
      requestedAmount: input.amountCents,
      requestKey: input.requestKey,
      reason: input.reason,
      partial: !fullyRefunded,
      actorUserId: input.actorUserId,
    }));
    if (eventError?.code === '23505') {
      const winner = await refundEventBySquareId(deps.db, refundId);
      const processorReplay = winner ? replayForSquareRefund(winner, {
        brandId: order.brand_id,
        orderId: input.orderId,
        refundId,
        amountCents,
      }) : null;
      if (!winner || !processorReplay) {
        throw new OrderError('invalid_request',
          'That idempotency key belongs to a different refund attempt.');
      }
      const requestReplay = replayForRequest([winner], {
        brandId: order.brand_id,
        orderId: input.orderId,
        requestKey: input.requestKey,
        amountCents: input.amountCents,
      });
      if (requestReplay.outcome === 'match') return requestReplay.result;
      if (requestReplay.outcome === 'conflict' || winner.refund_request_key !== null) {
        throw new OrderError('invalid_request',
          'That idempotency key belongs to a different refund attempt.');
      }
      return await claimWebhookRefundWinner(deps.db, {
        brandId: order.brand_id,
        orderId: input.orderId,
        refundId,
        refundCents: amountCents,
        requestKey: input.requestKey,
        requestedAmount: input.amountCents,
      });
    }
    if (eventError) throw eventError;

    await recordFeeRefund(deps.db, input.orderId, appFeeCents);
    return { orderId: input.orderId, refundId, amountCents };
  } finally {
    await endOrderRefund(deps.db, input.orderId, input.requestKey);
  }
}
