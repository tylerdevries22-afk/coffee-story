export type RequestedRefundAmount = number | 'full';

export type RefundEventRecord = {
  brand_id: string;
  order_id: string;
  square_refund_id: string | null;
  refund_cents: number | null;
  refund_request_key: string | null;
  snapshot: Record<string, unknown> | null;
};

export type RefundResult = {
  orderId: string;
  refundId: string;
  amountCents: number;
};

export type RefundReplayCheck =
  | { outcome: 'none' }
  | { outcome: 'conflict' }
  | { outcome: 'match'; result: RefundResult };

function positiveInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null;
}

function refundAmount(event: RefundEventRecord): number | null {
  const typed = positiveInteger(event.refund_cents);
  const manual = positiveInteger(event.snapshot?.amount_cents);
  const webhook = positiveInteger(event.snapshot?.refunded_cents);
  if (manual !== null && webhook !== null && manual !== webhook) return null;
  const snapshot = manual ?? webhook;
  if (typed !== null && snapshot !== null && typed !== snapshot) return null;
  return typed ?? snapshot;
}

function snapshotRefundId(event: RefundEventRecord): string | null {
  const manual = event.snapshot?.refund_id;
  const webhook = event.snapshot?.square_refund_id;
  if (typeof manual === 'string') return manual;
  return typeof webhook === 'string' ? webhook : null;
}

function accountingRefundId(event: RefundEventRecord): string | null {
  return event.square_refund_id ?? snapshotRefundId(event);
}

function validatedResult(event: RefundEventRecord): RefundResult | null {
  const refundId = event.square_refund_id;
  const amountCents = positiveInteger(event.refund_cents);
  const snapshotId = snapshotRefundId(event);
  if (!refundId || amountCents === null || (snapshotId !== null && snapshotId !== refundId)) return null;
  return { orderId: event.order_id, refundId, amountCents };
}

/** Counts each processor refund id once, including legacy/manual and webhook snapshot shapes. */
export function refundedCentsFrom(events: readonly RefundEventRecord[]): number {
  const amounts = new Map<string, number>();
  for (const event of events) {
    const refundId = accountingRefundId(event);
    const amountCents = refundAmount(event);
    if (!refundId || amountCents === null) continue;
    amounts.set(refundId, Math.max(amounts.get(refundId) ?? 0, amountCents));
  }
  return [...amounts.values()].reduce((sum, amount) => sum + amount, 0);
}

/** Recovers a completed caller attempt before mutable refund limits are recalculated. */
export function replayForRequest(
  events: readonly RefundEventRecord[],
  expected: { brandId: string; orderId: string; requestKey: string; amountCents: RequestedRefundAmount },
): RefundReplayCheck {
  const matchingKey = events.filter((event) => event.refund_request_key === expected.requestKey);
  if (matchingKey.length === 0) return { outcome: 'none' };
  const results = matchingKey.map(validatedResult);
  const first = results[0];
  if (!first) return { outcome: 'conflict' };
  const matches = matchingKey.every((event, index) => {
    const result = results[index];
    if (!result) return false;
    return event.brand_id === expected.brandId
      && event.order_id === expected.orderId
      && event.snapshot?.request_key === expected.requestKey
      && event.snapshot?.requested_amount === expected.amountCents
      && result.refundId === first.refundId
      && result.amountCents === first.amountCents;
  });
  return matches ? { outcome: 'match', result: first } : { outcome: 'conflict' };
}

/** A 23505 is success only when the unique refund winner is exactly this refund. */
export function replayForSquareRefund(
  event: RefundEventRecord,
  expected: { brandId: string; orderId: string; refundId: string; amountCents: number },
): RefundResult | null {
  const result = validatedResult(event);
  if (
    !result
    || event.brand_id !== expected.brandId
    || result.orderId !== expected.orderId
    || result.refundId !== expected.refundId
    || result.amountCents !== expected.amountCents
  ) return null;
  return result;
}

/** Validates the row returned after an unclaimed webhook refund is linked to an attended attempt. */
export function replayForClaimedRefund(
  event: RefundEventRecord,
  expected: {
    brandId: string;
    orderId: string;
    refundId: string;
    refundCents: number;
    requestKey: string;
    requestedAmount: RequestedRefundAmount;
  },
): RefundResult | null {
  const processorReplay = replayForSquareRefund(event, {
    brandId: expected.brandId,
    orderId: expected.orderId,
    refundId: expected.refundId,
    amountCents: expected.refundCents,
  });
  const requestReplay = replayForRequest([event], {
    brandId: expected.brandId,
    orderId: expected.orderId,
    requestKey: expected.requestKey,
    amountCents: expected.requestedAmount,
  });
  if (!processorReplay || requestReplay.outcome !== 'match') return null;
  return requestReplay.result.refundId === processorReplay.refundId
    && requestReplay.result.amountCents === processorReplay.amountCents
    ? processorReplay
    : null;
}

export function manualRefundEvent(input: {
  brandId: string;
  orderId: string;
  type: string;
  refundId: string;
  amountCents: number;
  requestedAmount: RequestedRefundAmount;
  requestKey: string;
  reason: string;
  partial: boolean;
  actorUserId: string | null;
}) {
  return {
    brand_id: input.brandId,
    order_id: input.orderId,
    type: input.type,
    square_refund_id: input.refundId,
    refund_cents: input.amountCents,
    refund_request_key: input.requestKey,
    snapshot: {
      refund_id: input.refundId,
      amount_cents: input.amountCents,
      requested_amount: input.requestedAmount,
      request_key: input.requestKey,
      reason: input.reason,
      partial: input.partial,
    },
    actor_user_id: input.actorUserId,
    source: 'operator',
  };
}
