import type { SquareConfig } from '@platform/engine';
import type { SupabaseClient } from '@supabase/supabase-js';

import { log } from './log';
import { loadDueSquareLinks } from './square-link-maintenance-loader';
import { inspectDueSquareLink, recoverDueSquareLink } from './square-link-provider';
import type {
  DueSquareLink, LinkCancellationEvidence, LinkMaintenanceDeps, LinkPaymentEvidence,
  SquareLinkExpirySummary,
} from './square-link-maintenance-types';

export type { DueSquareLink, SquareLinkExpirySummary } from './square-link-maintenance-types';

const CONCURRENCY = 10;

async function finalizeExpiry(
  db: SupabaseClient, row: DueSquareLink, evidence: LinkCancellationEvidence,
): Promise<boolean> {
  if (!row.paymentLinkId || !row.squareOrderId) return false;
  const result = await db.rpc('expire_square_checkout_quote', {
    p_order_id: row.order_id, p_claim_generation: row.claim_generation,
    p_payment_link_id: row.paymentLinkId, p_square_order_id: row.squareOrderId,
    p_provider_order_version: evidence.providerOrderVersion,
    p_provider_order_state: evidence.providerOrderState,
  });
  if (result.error) throw result.error;
  return result.data === true;
}

async function reconcilePayment(
  db: SupabaseClient, row: DueSquareLink, evidence: LinkPaymentEvidence,
): Promise<boolean> {
  if (!row.squareOrderId) return false;
  const result = await db.rpc('record_square_payment_settlement', {
    target_order: row.order_id, square_event: `reconcile:${evidence.paymentId}`,
    square_order: row.squareOrderId, square_payment: evidence.paymentId,
    settled_fee_cents: evidence.feeCents, square_event_type: 'payment.reconciled',
  });
  if (result.error) throw result.error;
  return true;
}

/** Recover, disable, then release expired hosted checkout reservations. */
export async function expireDueSquareCheckoutLinks(
  db: SupabaseClient, square: SquareConfig, now: Date, deps: LinkMaintenanceDeps = {},
): Promise<SquareLinkExpirySummary> {
  const summary: SquareLinkExpirySummary = {
    scanned: 0, cancelled: 0, reconciled: 0, failed: 0, stale: 0, scanFailed: false,
  };
  let rows: DueSquareLink[];
  try { rows = await (deps.load ?? loadDueSquareLinks)(db, now); }
  catch {
    log.error('square.checkout_expiry_scan_failed', { stage: 'claim_due_quotes' });
    summary.scanFailed = true;
    return summary;
  }
  summary.scanned = rows.length;
  for (let offset = 0; offset < rows.length; offset += CONCURRENCY) {
    const results = await Promise.all(rows.slice(offset, offset + CONCURRENCY).map(async (row) => {
      let recovered: DueSquareLink;
      try {
        recovered = await (deps.recover ?? recoverDueSquareLink)(db, square, row);
        const evidence = await (deps.inspect ?? inspectDueSquareLink)(square, recovered);
        if (evidence.kind === 'payment') {
          return await (deps.reconcile ?? reconcilePayment)(db, recovered, evidence)
            ? 'reconciled' as const : 'stale' as const;
        }
        return await (deps.finalize ?? finalizeExpiry)(db, recovered, evidence)
          ? 'cancelled' as const : 'stale' as const;
      } catch { return 'failed' as const; }
    }));
    for (const result of results) summary[result] += 1;
  }
  return summary;
}
