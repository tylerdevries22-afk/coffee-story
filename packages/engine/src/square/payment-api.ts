import { call, PLATFORM_CURRENCY, type SquareConfig } from './transport';
import type { SquarePaymentReceipt } from './payment-receipt';

export function createSquarePayment(
  config: SquareConfig,
  token: string,
  input: {
    sourceId: string;             // card nonce / payment token from the app
    squareOrderId: string;
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
      amount_money: { amount: input.amountCents, currency: PLATFORM_CURRENCY },
      ...(input.tipCents > 0 ? { tip_money: { amount: input.tipCents, currency: PLATFORM_CURRENCY } } : {}),
      app_fee_money: { amount: input.appFeeCents, currency: PLATFORM_CURRENCY },
    },
  });
}

export function refundSquarePayment(
  config: SquareConfig,
  token: string,
  input: { paymentId: string; amountCents: number; referenceId: string; reason: string },
): Promise<{ refund?: { id?: string; status?: string } }> {
  return call(config, '/v2/refunds', {
    method: 'POST',
    token,
    body: {
      idempotency_key: `refund-${input.referenceId}`,
      payment_id: input.paymentId,
      amount_money: { amount: input.amountCents, currency: PLATFORM_CURRENCY },
      reason: input.reason,
    },
  });
}

/** Retrieve immutable collected amounts when repairing a linked payment. */
export function getSquarePayment(config: SquareConfig, token: string, paymentId: string)
: Promise<{ payment?: SquarePaymentReceipt }> {
  return call(config, `/v2/payments/${encodeURIComponent(paymentId)}`, { method: 'GET', token });
}
