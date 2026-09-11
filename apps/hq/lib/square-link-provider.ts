import {
  buildSquareBalanceLine,
  createPaymentLink,
  decryptToken,
  deletePaymentLink,
  exactSquareCheckoutIdentity,
  getSquarePayment,
  loadTokenKey,
  retrieveSquareOrder,
  settledPaymentFee,
  SquareApiError,
  type SquareConfig,
} from '@platform/engine';
import type { SupabaseClient } from '@supabase/supabase-js';

import type { DueSquareLink, LinkInspection } from './square-link-maintenance-types';

function secured(row: DueSquareLink): row is DueSquareLink & {
  checkoutUrl: string; paymentLinkId: string; squareOrderId: string;
  squareLocationId: string; accessTokenEncrypted: string;
  grossCents: number; expectedFeeCents: number;
} {
  return row.valid && Boolean(row.checkoutUrl && row.paymentLinkId && row.squareOrderId
    && row.squareLocationId && row.accessTokenEncrypted
    && row.grossCents !== null && row.expectedFeeCents !== null);
}

/** Deterministically recover any missing provider link identity under the cleanup lease. */
export async function recoverDueSquareLink(
  db: SupabaseClient, square: SquareConfig, row: DueSquareLink,
): Promise<DueSquareLink> {
  if (secured(row)) return row;
  if (!row.valid || !row.squareLocationId || !row.accessTokenEncrypted
    || row.grossCents === null || row.expectedFeeCents === null) {
    throw new Error('Checkout recovery data is incomplete.');
  }
  const token = decryptToken(row.accessTokenEncrypted, loadTokenKey());
  const response = await createPaymentLink(square, token, {
    squareLocationId: row.squareLocationId, referenceId: row.order_id,
    lines: buildSquareBalanceLine(row.grossCents),
    taxCents: 0, taxLabel: 'Sales Tax', tipCents: 0, storedValueCents: 0,
    appFeeCents: row.expectedFeeCents,
  });
  const identity = exactSquareCheckoutIdentity(response, {
    amountCents: row.grossCents, squareLocationId: row.squareLocationId,
    referenceId: row.order_id,
  });
  if ((row.checkoutUrl && row.checkoutUrl !== identity.checkoutUrl)
    || (row.paymentLinkId && row.paymentLinkId !== identity.paymentLinkId)
    || (row.squareOrderId && row.squareOrderId !== identity.squareOrderId)) {
    throw new Error('Checkout replay identity mismatch.');
  }
  const bound = await db.rpc('bind_square_checkout_link', {
    p_order_id: row.order_id, p_claim_generation: row.claim_generation,
    p_checkout_url: identity.checkoutUrl, p_payment_link_id: identity.paymentLinkId,
    p_square_order_id: identity.squareOrderId,
  });
  if (bound.error) throw bound.error;
  if (bound.data !== true) throw new Error('Stale checkout cleanup lease.');
  return { ...row, ...identity };
}

function paymentIdFromTenders(value: unknown): string | null {
  if (value === undefined || (Array.isArray(value) && value.length === 0)) return null;
  if (!Array.isArray(value) || value.length !== 1) throw new Error('Indeterminate Square tenders.');
  const tender = value[0];
  if (!tender || typeof tender !== 'object') throw new Error('Invalid Square tender.');
  const item = tender as Record<string, unknown>;
  if (item.type !== 'CARD') throw new Error('Unexpected Square tender type.');
  const paymentId = typeof item.payment_id === 'string' && item.payment_id ? item.payment_id : null;
  const tenderId = typeof item.id === 'string' && item.id ? item.id : null;
  if (paymentId && tenderId && paymentId !== tenderId) throw new Error('Conflicting tender ids.');
  if (!paymentId && !tenderId) throw new Error('Missing Square payment id.');
  return paymentId ?? tenderId;
}

/** Disable the page, or recover an exact completed provider payment. */
export async function inspectDueSquareLink(
  square: SquareConfig, row: DueSquareLink,
): Promise<LinkInspection> {
  if (!secured(row)) throw new Error('Checkout cancellation data is incomplete.');
  const token = decryptToken(row.accessTokenEncrypted, loadTokenKey());
  let deleteError: SquareApiError | null = null;
  try {
    const deleted = await deletePaymentLink(square, token, row.paymentLinkId);
    if (deleted.id !== row.paymentLinkId || deleted.cancelled_order_id !== row.squareOrderId) {
      throw new Error('Square checkout cancellation identity mismatch.');
    }
  } catch (error) {
    if (!(error instanceof SquareApiError)) throw error;
    deleteError = error;
  }
  const order = (await retrieveSquareOrder(square, token, row.squareOrderId)).order;
  if (order?.id !== row.squareOrderId || order.location_id !== row.squareLocationId
    || !Number.isSafeInteger(order.version) || (order.version ?? -1) < 0) {
    throw new Error('Square checkout order identity could not be confirmed.');
  }
  const paymentId = paymentIdFromTenders(order.tenders);
  if (paymentId) {
    const payment = (await getSquarePayment(square, token, paymentId)).payment;
    if (payment?.id !== paymentId || payment.order_id !== row.squareOrderId
      || payment.location_id !== row.squareLocationId) {
      throw new Error('Square checkout payment identity could not be confirmed.');
    }
    const settled = settledPaymentFee(
      payment, paymentId, row.grossCents, row.expectedFeeCents, row.squareLocationId,
    );
    return { kind: 'payment', paymentId, feeCents: settled.feeCents };
  }
  if (order.state !== 'CANCELED') {
    if (deleteError) throw deleteError;
    throw new Error('Square checkout cancellation could not be confirmed.');
  }
  return {
    kind: 'cancelled', providerOrderVersion: order.version as number,
    providerOrderState: 'CANCELED',
  };
}
