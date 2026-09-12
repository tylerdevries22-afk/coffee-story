import { call, PLATFORM_CURRENCY, type SquareConfig } from './transport';
import type { SquarePaymentReceipt } from './payment-receipt';

export function createSquarePayment(
  config: SquareConfig,
  token: string,
  input: {
    sourceId: string;             // card nonce / payment token from the app
    squareOrderId: string;
    squareLocationId: string;
    referenceId: string;
    amountCents: number;
    tipCents: number;
    appFeeCents: number;          // rule 3: the platform's cut, every payment
  },
): Promise<{ payment?: SquarePaymentReceipt }> {
  return call(config, '/v2/payments', {
    method: 'POST',
    token,
    body: {
      idempotency_key: `pay-${input.referenceId}`,
      source_id: input.sourceId,
      order_id: input.squareOrderId,
      location_id: input.squareLocationId,
      amount_money: { amount: input.amountCents, currency: PLATFORM_CURRENCY },
      ...(input.tipCents > 0 ? { tip_money: { amount: input.tipCents, currency: PLATFORM_CURRENCY } } : {}),
      app_fee_money: { amount: input.appFeeCents, currency: PLATFORM_CURRENCY },
    },
  });
}

/** Fence an unknown CreatePayment outcome under its original provider key. */
export async function cancelSquarePaymentByIdempotencyKey(
  config: SquareConfig,
  token: string,
  referenceId: string,
): Promise<void> {
  if (!referenceId.trim()) throw new RangeError('Square payment reference is required.');
  await call(config, '/v2/payments/cancel', {
    method: 'POST',
    token,
    body: { idempotency_key: `pay-${referenceId}` },
  });
}

export function refundSquarePayment(
  config: SquareConfig,
  token: string,
  input: {
    paymentId: string;
    amountCents: number;
    referenceId: string;
    reason: string;
    /**
     * The platform's share of this refund, returned with it.
     *
     * Square reads an absent `app_fee_money` as "the developer contributes
     * nothing", which makes the seller fund the whole refund while the platform
     * keeps the fee it took on the original sale. On a franchise platform that
     * is the franchisee paying us to undo their own sale, so the fee goes back
     * in proportion to what is being returned. Omitted only when the payment
     * carried no application fee.
     */
    appFeeCents?: number;
  },
): Promise<{ refund?: SquareRefundReceipt }> {
  const appFee = input.appFeeCents ?? 0;
  return call(config, '/v2/refunds', {
    method: 'POST',
    token,
    body: {
      idempotency_key: `refund-${input.referenceId}`,
      payment_id: input.paymentId,
      amount_money: { amount: input.amountCents, currency: PLATFORM_CURRENCY },
      ...(appFee > 0
        ? { app_fee_money: { amount: appFee, currency: PLATFORM_CURRENCY } }
        : {}),
      reason: input.reason,
    },
  });
}

export type SquareRefundReceipt = {
  id?: string;
  payment_id?: string;
  status?: string;
  amount_money?: { amount?: number; currency?: string };
};

/** Retrieve a submitted refund by its immutable provider identity. */
export function getSquareRefund(config: SquareConfig, token: string, refundId: string)
: Promise<{ refund?: SquareRefundReceipt }> {
  if (!refundId.trim()) throw new RangeError('Square refund id is required.');
  return call(config, `/v2/refunds/${encodeURIComponent(refundId)}`, { method: 'GET', token });
}

/** Retrieve immutable collected amounts when repairing a linked payment. */
export function getSquarePayment(config: SquareConfig, token: string, paymentId: string)
: Promise<{ payment?: SquarePaymentReceipt }> {
  return call(config, `/v2/payments/${encodeURIComponent(paymentId)}`, { method: 'GET', token });
}
