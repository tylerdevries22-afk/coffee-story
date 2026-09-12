/**
 * The platform's side of a refund: how much of the application fee goes back
 * with the guest's money, and recording that it did.
 *
 * Separate from refund-order because the two halves fail differently. Reading
 * the fee happens before Square is called, so a failure there is a refusal
 * nothing has yet acted on; recording it happens after, when the money has
 * already moved and throwing would be a lie. Keeping them in one file made
 * that distinction easy to lose.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

import { refundAppFeeCents } from '../fees';

type PlatformFeeRow = {
  fee_cents: number;
  gross_cents: number;
  refunded_fee_cents: number;
};

/**
 * The platform's share of this refund, read from the fee row the payment
 * wrote.
 *
 * A missing row means no application fee was ever charged, which is not an
 * error -- a pay-at-pickup order never produces one. A failed read is an
 * error: resolving it to zero would quietly keep a fee the platform is not
 * owed, and this runs before Square is called, so refusing costs nothing.
 */
export async function resolveRefundAppFeeCents(
  db: SupabaseClient,
  orderId: string,
  refundAmountCents: number,
): Promise<number> {
  const feeRow = await db
    .from('platform_fees')
    .select('fee_cents, gross_cents, refunded_fee_cents')
    .eq('order_id', orderId)
    .maybeSingle<PlatformFeeRow>();
  if (feeRow.error) throw feeRow.error;
  if (!feeRow.data) return 0;
  return refundAppFeeCents({
    feeCents: feeRow.data.fee_cents,
    grossCents: feeRow.data.gross_cents,
    alreadyRefundedFeeCents: feeRow.data.refunded_fee_cents,
    refundAmountCents,
  });
}

/**
 * Book the platform's share of a refund against the fee row.
 *
 * After the refund event, never before: the event is the record that the money
 * moved, and a fee reversal without one would overstate what was returned.
 *
 * Deliberately does not throw. Square has already returned the guest's money by
 * the time this runs, so failing the call would tell an operator the refund did
 * not happen when it did -- and they would retry, which is the one outcome
 * worth avoiding. The discrepancy stays detectable instead: a refund event
 * whose fee reversal is missing shows up as refunded_fee_cents trailing the
 * refunded total on that order. The RPC clamps to what is left unreturned, so a
 * retry cannot double-count either.
 */
export async function recordFeeRefund(
  db: SupabaseClient,
  orderId: string,
  appFeeCents: number,
): Promise<void> {
  if (appFeeCents <= 0) return;
  await db.rpc('record_platform_fee_refund', {
    p_order_id: orderId,
    p_refund_fee_cents: appFeeCents,
  });
}
