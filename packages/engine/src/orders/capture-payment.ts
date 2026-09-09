import type { SupabaseClient } from '@supabase/supabase-js';

import type { FeeConfig } from '../fees';
import {
  createSquareOrder, createSquarePayment, type SquareConfig,
} from '../square/client';
import { settledPaymentFee, squareUsdCents } from '../square/payment-receipt';

import type { SnapshotLine } from './internal';
import {
  bindSquarePaymentAttempt, finalizeSquareCardPayment, releasePlatformFeeQuote,
} from './platform-fee-bindings';
import {
  recoverBoundSquarePayment, recoverPreboundSquareOrder, type BoundPaymentOrder,
} from './capture-payment-recovery';
import {
  appFeeForCharge,
} from './platform-fees';
import { isDefinitiveSquareRejection, safeSquarePaymentError } from './provider-error';
import { squareCardFundingAmounts } from './square-card-funding';
import { buildSquareBalanceLine } from './square-lines';
import { OrderError } from './types';

export type CapturePaymentDeps = {
  db: SupabaseClient;
  square: SquareConfig;
  locationAccessToken: string;
  squareLocationId: string;
  feeConfig: FeeConfig;
  locationTimezone: string;
};

export type CapturePaymentInput = {
  orderId: string;
  /** Card token from the app's payment SDK. */
  sourceId: string;
};

export async function captureSquarePayment(
  deps: CapturePaymentDeps,
  input: CapturePaymentInput,
): Promise<{ orderId: string; squarePaymentId: string }> {
  const loaded = await deps.db
    .from('orders')
    .select('id, brand_id, location_id, customer_id, status, tender_type, totals, subtotal_cents, tax_cents, tip_cents, total_cents, stored_value_applied_cents, square_order_id, square_payment_id')
    .eq('id', input.orderId)
    .maybeSingle<{
      id: string;
      brand_id: string;
      location_id: string;
      customer_id: string | null;
      status: string;
      tender_type: string;
      totals: { lines?: SnapshotLine[] } & Record<string, unknown>;
      subtotal_cents: number;
      tax_cents: number;
      tip_cents: number;
      total_cents: number;
      stored_value_applied_cents: number;
      square_order_id: string | null;
      square_payment_id: string | null;
    }>();
  if (loaded.error) throw loaded.error;
  const order = loaded.data;
  if (!order) throw new OrderError('invalid_request', 'That order does not exist.');
  if (order.tender_type !== 'square_card') {
    throw new OrderError('invalid_request', `Order is a ${order.tender_type} order; only square_card orders can be captured.`);
  }
  if (order.square_payment_id) {
    return recoverBoundSquarePayment(deps, order as BoundPaymentOrder);
  }
  if (order.status !== 'created') {
    throw new OrderError('invalid_request', `Order is ${order.status}; only a created order can be captured.`);
  }

  const lines = (order.totals.lines ?? []).map((line) => ({
    name: line.name,
    quantity: line.quantity,
    unitPriceCents: line.unit_price_cents,
    options: line.options ?? [],
    packContents: line.pack_contents ?? [],
  }));
  const cardChargeCents = order.total_cents - order.stored_value_applied_cents;
  const linesTotal = lines.reduce(
    (sum, line) => sum + line.unitPriceCents * line.quantity, 0,
  );
  if (![order.subtotal_cents, order.tax_cents, order.tip_cents,
    order.total_cents, order.stored_value_applied_cents, linesTotal,
    cardChargeCents].every(Number.isSafeInteger)
    || order.subtotal_cents < 0 || order.tax_cents < 0 || order.tip_cents < 0
    || order.stored_value_applied_cents < 0 || linesTotal !== order.subtotal_cents
    || order.total_cents !== order.subtotal_cents + order.tax_cents + order.tip_cents
    || cardChargeCents <= 0) {
    throw new OrderError('invalid_request', 'This order has invalid payment totals.');
  }
  const { providerTipCents, providerOrderTotalCents: squareOrderTotalCents }
    = squareCardFundingAmounts(cardChargeCents, order.tip_cents);
  let squareOrderId = order.square_order_id;
  if (squareOrderId) {
    const recovered = await recoverPreboundSquareOrder(deps, {
      ...order, square_order_id: squareOrderId, square_payment_id: null,
    });
    if (recovered) return recovered;
    throw new OrderError('payment_unavailable',
      'This card attempt is being reconciled. Create a new order if it is later cancelled.');
  }
  const fee = await appFeeForCharge(deps.db, {
    orderId: order.id,
    locationId: order.location_id,
    chargeCents: cardChargeCents,
    feeConfig: deps.feeConfig,
    locationTimezone: deps.locationTimezone,
  });
  if (!fee.claimCreated) {
    throw new OrderError('payment_unavailable',
      'Card payment is already being prepared. Wait briefly before checking this order again.');
  }
  if (!squareOrderId) {
    try {
      const squareOrder = await createSquareOrder(deps.square, deps.locationAccessToken, {
        squareLocationId: deps.squareLocationId,
        referenceId: order.id,
        lines: buildSquareBalanceLine(squareOrderTotalCents),
        taxCents: 0,
        taxLabel: 'Sales Tax',
        storedValueCents: 0,
      });
      squareOrderId = squareOrder.order?.id ?? null;
      if (squareOrder.order?.location_id !== deps.squareLocationId
        || squareOrder.order.reference_id !== order.id
        || squareUsdCents(squareOrder.order.total_money) !== squareOrderTotalCents) {
        throw new Error('provider order identity mismatch');
      }
    } catch (error) {
      if (isDefinitiveSquareRejection(error)) {
        await releasePlatformFeeQuote(deps.db, {
          orderId: order.id, claimGeneration: fee.claimGeneration,
        }).catch(() => false);
      }
      throw safeSquarePaymentError(error);
    }
    if (!squareOrderId) {
      throw new OrderError('payment_unavailable', 'Card payment could not be prepared. Retry this order.');
    }
  }
  try {
    const bound = await bindSquarePaymentAttempt(deps.db, {
      orderId: order.id, claimGeneration: fee.claimGeneration, squareOrderId,
    });
    if (!bound) throw new Error('stale payment attempt');
  } catch {
    throw new OrderError('payment_unavailable',
      'Card payment could not be authorized. Check this order before trying again.');
  }

  let payment;
  try {
    payment = await createSquarePayment(deps.square, deps.locationAccessToken, {
      sourceId: input.sourceId,
      squareOrderId,
      squareLocationId: deps.squareLocationId,
      referenceId: order.id,
      amountCents: squareOrderTotalCents,
      tipCents: providerTipCents,
      appFeeCents: fee.feeCents,
    });
  } catch (error) {
    throw safeSquarePaymentError(error, 'new_order');
  }
  const paymentId = payment.payment?.id;
  if (!paymentId || payment.payment?.order_id !== squareOrderId) {
    throw new OrderError('payment_unavailable',
      'Card payment could not be confirmed. Retry this order; the same payment reference will be reused.');
  }
  let settledFee;
  try {
    settledFee = settledPaymentFee(
      payment.payment, paymentId, cardChargeCents, fee.feeCents, deps.squareLocationId,
    );
  } catch {
    throw new OrderError('payment_unavailable', 'Card payment settlement could not be confirmed.');
  }

  try {
    const finalized = await finalizeSquareCardPayment(deps.db, {
      orderId: order.id,
      claimGeneration: fee.claimGeneration,
      squareOrderId,
      squarePaymentId: paymentId,
      settledFeeCents: settledFee.feeCents,
    });
    if (!finalized) throw new Error('payment settlement conflict');
  } catch {
    throw new OrderError('payment_unavailable',
      'Card payment was confirmed but local settlement is still pending. Retry this order.');
  }

  return { orderId: order.id, squarePaymentId: paymentId };
}
