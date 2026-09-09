/**
 * The square_link tender's back half: a Square-hosted checkout page for an
 * order that is already priced and written.
 */
import { createPaymentLink } from '../square/client';

import type { CapturePaymentDeps } from './capture-payment';
import type { SnapshotLine } from './internal';
import {
  bindSquareCheckoutLink, bindSquareCheckoutLinkReplay, releasePlatformFeeQuote,
} from './platform-fee-bindings';
import { appFeeForCharge } from './platform-fees';
import { buildSquareBalanceLine } from './square-lines';
import { exactSquareCheckoutIdentity } from './square-link-response';
import { isDefinitiveSquareRejection, safeSquarePaymentError } from './provider-error';
import { OrderError } from './types';

/**
 * What to call the tax line on the checkout page. One authority keeps its own
 * name; several become a single "Sales Tax" charge, because the guest is
 * paying one rounded sum and itemising four rates on a payment page invites
 * a cent-level argument the receipt already answers.
 */
function taxLabelFor(totals: { tax_rows?: { label?: string }[] } & Record<string, unknown>): string {
  const rows = totals.tax_rows ?? [];
  const single = rows.length === 1 ? rows[0]?.label : undefined;
  return typeof single === 'string' && single.length > 0 ? single : 'Sales Tax';
}

export type CheckoutLinkInput = {
  orderId: string;
};

/**
 * The square_link tender's back half: a Square-hosted checkout page for an
 * order that is already priced and written. Nothing here moves the order —
 * it stays 'created' until Square's webhook says the money arrived, so a
 * guest who abandons the page leaves no phantom paid order behind.
 *
 * Idempotent: an order that already carries a link gets that same link back,
 * because minting a second page for one cart is how a guest pays twice.
 */
export async function createSquareCheckoutLink(
  deps: CapturePaymentDeps,
  input: CheckoutLinkInput,
): Promise<{ orderId: string; checkoutUrl: string; replayed: boolean }> {
  const loaded = await deps.db
    .from('orders')
    .select('id, brand_id, location_id, status, tender_type, totals, tax_cents, tip_cents, total_cents, stored_value_applied_cents, square_checkout_url, square_payment_link_id, square_order_id')
    .eq('id', input.orderId)
    .maybeSingle<{
      id: string;
      brand_id: string;
      location_id: string;
      status: string;
      tender_type: string;
      totals: { lines?: SnapshotLine[] } & Record<string, unknown>;
      tax_cents: number;
      tip_cents: number;
      total_cents: number;
      stored_value_applied_cents: number;
      square_checkout_url: string | null;
      square_payment_link_id: string | null;
      square_order_id: string | null;
    }>();
  if (loaded.error) throw loaded.error;
  const order = loaded.data;
  if (!order) throw new OrderError('invalid_request', 'That order does not exist.');
  if (order.tender_type !== 'square_link') {
    throw new OrderError('invalid_request', `Order is a ${order.tender_type} order; only square_link orders get a checkout page.`);
  }
  if (order.status !== 'created') {
    throw new OrderError('invalid_request', `Order is ${order.status}; only a created order can be sent to checkout.`);
  }
  if (order.square_checkout_url && order.square_payment_link_id && order.square_order_id) {
    return { orderId: order.id, checkoutUrl: order.square_checkout_url, replayed: true };
  }
  const hasPartialIdentity = Boolean(
    order.square_checkout_url || order.square_payment_link_id || order.square_order_id,
  );
  const lines = (order.totals.lines ?? []).map((line) => ({
    name: line.name,
    quantity: line.quantity,
    unitPriceCents: line.unit_price_cents,
    options: line.options ?? [],
    packContents: line.pack_contents ?? [],
  }));
  const chargeCents = order.total_cents - order.stored_value_applied_cents;
  // The page must ask for exactly what the order says, or the guest pays one
  // number while the books, the metrics and the platform's fee use another.
  // The first version sent line items alone: tax and tip were simply never
  // collected, while the fee was still computed on the full total.
  const taxCents = order.tax_cents;
  const tipCents = order.tip_cents;
  const linesTotal = lines.reduce((sum, line) => sum + line.unitPriceCents * line.quantity, 0);
  const storedValueCents = order.stored_value_applied_cents;
  if (![linesTotal, taxCents, tipCents, storedValueCents, chargeCents].every(Number.isSafeInteger)
    || storedValueCents < 0
    || linesTotal + taxCents + tipCents - storedValueCents !== chargeCents
    || chargeCents <= 0) {
    throw new Error(
      `Checkout would not charge the order total: lines ${linesTotal} + tax ${taxCents} + tip ${tipCents} != ${chargeCents}.`,
    );
  }

  const fee = await appFeeForCharge(deps.db, {
    orderId: order.id,
    locationId: order.location_id,
    chargeCents,
    feeConfig: deps.feeConfig,
    locationTimezone: deps.locationTimezone,
    requireExisting: hasPartialIdentity,
  });

  let link;
  try {
    link = await createPaymentLink(deps.square, deps.locationAccessToken, {
      squareLocationId: deps.squareLocationId,
      referenceId: order.id,
      lines: buildSquareBalanceLine(chargeCents),
      taxCents: 0,
      taxLabel: taxLabelFor(order.totals),
      tipCents: 0,
      storedValueCents: 0,
      appFeeCents: fee.feeCents,
    });
  } catch (error) {
    if (fee.claimCreated && isDefinitiveSquareRejection(error)) {
      await releasePlatformFeeQuote(deps.db, {
        orderId: order.id, claimGeneration: fee.claimGeneration,
      }).catch(() => false);
    }
    throw safeSquarePaymentError(error);
  }
  let identity;
  try {
    identity = exactSquareCheckoutIdentity(link, {
      amountCents: chargeCents, squareLocationId: deps.squareLocationId,
      referenceId: order.id,
    });
  } catch {
    throw new OrderError('payment_unavailable',
      'Card checkout could not be prepared. Retry this order.');
  }
  const { checkoutUrl, paymentLinkId, squareOrderId } = identity;

  try {
    const binding = { orderId: order.id, checkoutUrl, paymentLinkId, squareOrderId };
    const bound = fee.claimCreated
      ? await bindSquareCheckoutLink(deps.db, {
        ...binding, claimGeneration: fee.claimGeneration,
      })
      : await bindSquareCheckoutLinkReplay(deps.db, binding);
    if (!bound) throw new Error('stale checkout claim');
  } catch {
    throw new OrderError('payment_unavailable',
      'Card checkout was created but could not be secured. Retry this order.');
  }

  return { orderId: order.id, checkoutUrl, replayed: !fee.claimCreated };
}
