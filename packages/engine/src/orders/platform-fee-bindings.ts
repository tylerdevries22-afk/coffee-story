import type { SupabaseClient } from '@supabase/supabase-js';

import { squareApplicationFeeCapCents } from '../square/payment-receipt';

type ClaimIdentity = { orderId: string; claimGeneration: string };

export type SquarePaymentQuote = {
  grossCents: number;
  feeCents: number;
  feeBpsApplied: number;
  finalized: boolean;
};

/** Read immutable pricing for provider recovery without acquiring its claim. */
export async function getSquarePaymentQuote(
  db: SupabaseClient,
  input: { orderId: string; squareOrderId: string },
): Promise<SquarePaymentQuote> {
  const { data, error } = await db.rpc('get_square_payment_quote', {
    p_order_id: input.orderId,
    p_square_order_id: input.squareOrderId,
  }).single<{
    gross_cents: number;
    quoted_fee_cents: number;
    quoted_fee_bps_applied: number;
    quote_finalized: boolean;
  }>();
  if (error) throw error;
  const cap = Number.isSafeInteger(data.gross_cents) && data.gross_cents > 0
    ? squareApplicationFeeCapCents(data.gross_cents) : -1;
  if (!Number.isSafeInteger(data.gross_cents) || data.gross_cents <= 0
    || !Number.isSafeInteger(data.quoted_fee_cents) || data.quoted_fee_cents < 0
    || data.quoted_fee_cents > cap
    || !Number.isSafeInteger(data.quoted_fee_bps_applied)
    || data.quoted_fee_bps_applied < 0 || data.quoted_fee_bps_applied > 9_000
    || typeof data.quote_finalized !== 'boolean') {
    throw new Error('Invalid Square payment quote.');
  }
  return { grossCents: data.gross_cents, feeCents: data.quoted_fee_cents,
    feeBpsApplied: data.quoted_fee_bps_applied, finalized: data.quote_finalized };
}

/** Release a quote only while the caller still owns its exact generation. */
export async function releasePlatformFeeQuote(
  db: SupabaseClient,
  input: ClaimIdentity,
): Promise<boolean> {
  const { data, error } = await db.rpc('release_platform_fee_quote', {
    p_order_id: input.orderId,
    p_claim_generation: input.claimGeneration,
  });
  if (error) throw error;
  return data === true;
}

export async function bindSquareCheckoutLink(
  db: SupabaseClient,
  input: ClaimIdentity & {
    checkoutUrl: string;
    paymentLinkId: string;
    squareOrderId: string;
  },
): Promise<boolean> {
  const { data, error } = await db.rpc('bind_square_checkout_link', {
    p_order_id: input.orderId,
    p_claim_generation: input.claimGeneration,
    p_checkout_url: input.checkoutUrl,
    p_payment_link_id: input.paymentLinkId,
    p_square_order_id: input.squareOrderId,
  });
  if (error) throw error;
  return data === true;
}

/** Bind an identical deterministic provider replay without exposing claim ownership. */
export async function bindSquareCheckoutLinkReplay(
  db: SupabaseClient,
  input: { orderId: string; checkoutUrl: string; paymentLinkId: string; squareOrderId: string },
): Promise<boolean> {
  const { data, error } = await db.rpc('bind_square_checkout_link_replay', {
    p_order_id: input.orderId,
    p_checkout_url: input.checkoutUrl,
    p_payment_link_id: input.paymentLinkId,
    p_square_order_id: input.squareOrderId,
  });
  if (error) throw error;
  return data === true;
}

/** Persist provider order identity before any card can be charged. */
export async function bindSquarePaymentAttempt(
  db: SupabaseClient,
  input: ClaimIdentity & { squareOrderId: string },
): Promise<boolean> {
  const { data, error } = await db.rpc('bind_square_payment_attempt', {
    p_order_id: input.orderId,
    p_claim_generation: input.claimGeneration,
    p_square_order_id: input.squareOrderId,
  });
  if (error) throw error;
  return data === true;
}

/** Commit attended capture identity, fee receipt, and paid event atomically. */
export async function finalizeSquareCardPayment(
  db: SupabaseClient,
  input: ClaimIdentity & {
    squareOrderId: string;
    squarePaymentId: string;
    settledFeeCents: number;
  },
): Promise<boolean> {
  const { data, error } = await db.rpc('finalize_square_card_payment', {
    p_order_id: input.orderId,
    p_claim_generation: input.claimGeneration,
    p_square_order_id: input.squareOrderId,
    p_square_payment_id: input.squarePaymentId,
    p_settled_fee_cents: input.settledFeeCents,
  });
  if (error) throw error;
  return data === true;
}

/** Reconcile a provider-confirmed payment after an attended response was lost. */
export async function recordReconciledSquarePayment(
  db: SupabaseClient,
  input: {
    orderId: string; squareOrderId: string; squarePaymentId: string; settledFeeCents: number;
  },
): Promise<boolean> {
  const { data, error } = await db.rpc('record_square_payment_settlement', {
    target_order: input.orderId,
    square_event: `reconcile:${input.squarePaymentId}`,
    square_order: input.squareOrderId,
    square_payment: input.squarePaymentId,
    settled_fee_cents: input.settledFeeCents,
    square_event_type: 'payment.reconciled',
  });
  if (error) throw error;
  return data === true;
}
