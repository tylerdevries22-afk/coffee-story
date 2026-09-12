import {
  decryptToken, getSquareRefund, loadTokenKey, refundSquarePayment, SquareApiError,
  type SquareConfig,
} from '@platform/engine';
import type { SupabaseClient } from '@supabase/supabase-js';

import { log } from './log';
import {
  exactPaymentRemediationRefund,
  paymentRemediationRetryAt,
  validPaymentRemediationClaims,
  type DuePaymentRemediation,
  type PaymentRemediationDeps,
  type PaymentRemediationSummary,
  type SquareRefundProof,
} from './square-payment-remediation-types';

export type {
  DuePaymentRemediation, PaymentRemediationSummary,
} from './square-payment-remediation-types';

const CLAIM_LIMIT = 50;
const CONCURRENCY = 5;

type Connection = {
  brand_id: string;
  location_id: string;
  access_token_encrypted: string;
};

async function loadDuePaymentRemediations(
  db: SupabaseClient, now: Date,
): Promise<DuePaymentRemediation[]> {
  const claimed = await db.rpc('claim_due_square_payment_remediations', {
    p_now: now.toISOString(), p_limit: CLAIM_LIMIT,
  });
  if (claimed.error) throw claimed.error;
  if (!validPaymentRemediationClaims(claimed.data)) {
    throw new Error('Invalid Square payment remediation claim result.');
  }
  if (claimed.data.length === 0) return [];
  const locationIds = [...new Set(claimed.data.map((row) => row.location_id))];
  const connections = await db.from('square_connections')
    .select('brand_id, location_id, access_token_encrypted')
    .in('location_id', locationIds).returns<Connection[]>();
  if (connections.error) throw connections.error;
  const byTenant = new Map((connections.data ?? []).map((row) => [
    `${row.brand_id}:${row.location_id}`, row.access_token_encrypted,
  ]));
  return claimed.data.map((row) => ({
    orderId: row.order_id, brandId: row.brand_id, locationId: row.location_id,
    squareOrderId: row.square_order_id, squarePaymentId: row.square_payment_id,
    refundAmountCents: row.refund_amount_cents, refundRequestKey: row.refund_request_key,
    squareRefundId: row.square_refund_id,
    providerRefundStatus: row.provider_refund_status as 'PENDING' | null,
    attemptCount: row.attempt_count, claimGeneration: row.claim_generation,
    accessTokenEncrypted: byTenant.get(`${row.brand_id}:${row.location_id}`) ?? null,
  }));
}

async function sendRefund(
  square: SquareConfig, token: string, row: DuePaymentRemediation,
) {
  return refundSquarePayment(square, token, {
    paymentId: row.squarePaymentId,
    amountCents: row.refundAmountCents,
    referenceId: row.refundRequestKey,
    reason: 'Automatic reversal of a late payment',
  });
}

async function retrieveRefund(
  square: SquareConfig, token: string, row: DuePaymentRemediation,
) {
  if (!row.squareRefundId) throw new Error('Square refund identity is missing.');
  return getSquareRefund(square, token, row.squareRefundId);
}

async function finalizeRefund(
  db: SupabaseClient,
  row: DuePaymentRemediation,
  refund: SquareRefundProof,
): Promise<boolean> {
  const result = await db.rpc('finalize_square_payment_remediation', {
    p_order_id: row.orderId, p_claim_generation: row.claimGeneration,
    p_square_refund_id: refund.id, p_provider_refund_status: refund.status,
    p_provider_payment_id: refund.paymentId,
    p_provider_refund_amount_cents: refund.amountCents,
    p_provider_refund_currency: refund.currency,
  });
  if (result.error) throw result.error;
  return result.data === true;
}

async function failRefund(
  db: SupabaseClient, row: DuePaymentRemediation, code: string, retryAt: string,
): Promise<boolean> {
  const result = await db.rpc('fail_square_payment_remediation', {
    p_order_id: row.orderId, p_claim_generation: row.claimGeneration,
    p_error_code: code, p_retry_at: retryAt,
  });
  if (result.error) throw result.error;
  return result.data === true;
}

function providerFailureCode(error: unknown): string {
  if (error instanceof SquareApiError && error.status >= 400 && error.status < 500
    && error.status !== 429) return 'square_refund_rejected';
  return 'square_refund_unavailable';
}

async function recordFailure(
  db: SupabaseClient, row: DuePaymentRemediation, code: string, now: Date,
  fail: NonNullable<PaymentRemediationDeps['fail']>,
): Promise<'failed' | 'stale'> {
  try {
    return await fail(db, row, code, paymentRemediationRetryAt(now, row.attemptCount))
      ? 'failed' : 'stale';
  } catch { return 'failed'; }
}

async function remediate(
  db: SupabaseClient, square: SquareConfig, row: DuePaymentRemediation, now: Date,
  deps: PaymentRemediationDeps,
): Promise<'completed' | 'pending' | 'manual' | 'failed' | 'stale'> {
  const fail = deps.fail ?? failRefund;
  if (!row.accessTokenEncrypted) return recordFailure(db, row, 'square_connection_missing', now, fail);
  let token: string;
  try { token = decryptToken(row.accessTokenEncrypted, loadTokenKey()); }
  catch { return recordFailure(db, row, 'square_credential_invalid', now, fail); }
  let response: Awaited<ReturnType<typeof refundSquarePayment>>;
  try {
    response = row.squareRefundId
      ? await (deps.retrieve ?? retrieveRefund)(square, token, row)
      : await (deps.refund ?? sendRefund)(square, token, row);
  }
  catch (error) { return recordFailure(db, row, providerFailureCode(error), now, fail); }
  const refund = exactPaymentRemediationRefund(response.refund, row);
  if (!refund) return recordFailure(db, row, 'square_refund_invalid', now, fail);
  try {
    const changed = await (deps.finalize ?? finalizeRefund)(db, row, refund);
    if (!changed) return 'stale';
    if (refund.status === 'COMPLETED') return 'completed';
    return refund.status === 'PENDING' ? 'pending' : 'manual';
  } catch { return 'failed'; }
}

/** Issue or reconcile bounded full refunds for late card settlements. */
export async function remediateDueSquarePayments(
  db: SupabaseClient, square: SquareConfig, now: Date, deps: PaymentRemediationDeps = {},
): Promise<PaymentRemediationSummary> {
  const summary: PaymentRemediationSummary = {
    scanned: 0, completed: 0, pending: 0, manual: 0, failed: 0, stale: 0, scanFailed: false,
  };
  let rows: DuePaymentRemediation[];
  try { rows = await (deps.load ?? loadDuePaymentRemediations)(db, now); }
  catch { log.error('square.payment_remediation_scan_failed', { stage: 'load' }); summary.scanFailed = true; return summary; }
  summary.scanned = rows.length;
  for (let offset = 0; offset < rows.length; offset += CONCURRENCY) {
    const outcomes = await Promise.all(rows.slice(offset, offset + CONCURRENCY)
      .map((row) => remediate(db, square, row, now, deps)));
    for (const outcome of outcomes) summary[outcome] += 1;
  }
  return summary;
}
