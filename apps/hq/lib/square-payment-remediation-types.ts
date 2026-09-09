import type {
  SquareConfig, SquareRefundReceipt,
} from '@platform/engine';
import type { SupabaseClient } from '@supabase/supabase-js';

export type PaymentRemediationClaim = {
  order_id: string;
  brand_id: string;
  location_id: string;
  square_order_id: string;
  square_payment_id: string;
  refund_amount_cents: number;
  refund_request_key: string;
  square_refund_id: string | null;
  provider_refund_status: string | null;
  attempt_count: number;
  claim_generation: string;
};

export type DuePaymentRemediation = {
  orderId: string;
  brandId: string;
  locationId: string;
  squareOrderId: string;
  squarePaymentId: string;
  refundAmountCents: number;
  refundRequestKey: string;
  squareRefundId: string | null;
  providerRefundStatus: 'PENDING' | null;
  attemptCount: number;
  claimGeneration: string;
  accessTokenEncrypted: string | null;
};

export type SquareRefundProof = {
  id: string;
  status: 'PENDING' | 'COMPLETED' | 'REJECTED' | 'FAILED';
  paymentId: string;
  amountCents: number;
  currency: 'USD';
};

export type PaymentRemediationSummary = {
  scanned: number;
  completed: number;
  pending: number;
  manual: number;
  failed: number;
  stale: number;
  scanFailed: boolean;
};

export type PaymentRemediationDeps = {
  load?: (db: SupabaseClient, now: Date) => Promise<DuePaymentRemediation[]>;
  refund?: (
    square: SquareConfig, token: string, row: DuePaymentRemediation,
  ) => Promise<{ refund?: SquareRefundReceipt }>;
  retrieve?: (
    square: SquareConfig, token: string, row: DuePaymentRemediation,
  ) => Promise<{ refund?: SquareRefundReceipt }>;
  finalize?: (
    db: SupabaseClient, row: DuePaymentRemediation,
    refund: SquareRefundProof,
  ) => Promise<boolean>;
  fail?: (
    db: SupabaseClient, row: DuePaymentRemediation, code: string, retryAt: string,
  ) => Promise<boolean>;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function providerId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && !/\s/u.test(value)
    && Buffer.byteLength(value, 'utf8') >= 3 && Buffer.byteLength(value, 'utf8') <= 255;
}

export function validPaymentRemediationClaims(value: unknown): value is PaymentRemediationClaim[] {
  return Array.isArray(value) && value.every((entry) => {
    if (!entry || typeof entry !== 'object') return false;
    const row = entry as Record<string, unknown>;
    const uuidColumns = ['order_id', 'brand_id', 'location_id', 'refund_request_key', 'claim_generation'];
    const prior = row.square_refund_id === null && row.provider_refund_status === null
      || providerId(row.square_refund_id) && row.provider_refund_status === 'PENDING';
    return uuidColumns.every((column) => typeof row[column] === 'string' && UUID.test(row[column] as string))
      && row.refund_request_key === row.order_id
      && providerId(row.square_order_id) && providerId(row.square_payment_id)
      && Number.isSafeInteger(row.refund_amount_cents) && (row.refund_amount_cents as number) > 0
      && Number.isSafeInteger(row.attempt_count)
      && (row.attempt_count as number) >= 1 && (row.attempt_count as number) <= 2_147_483_647
      && prior;
  });
}

export function exactPaymentRemediationRefund(
  receipt: SquareRefundReceipt | undefined,
  row: DuePaymentRemediation,
): SquareRefundProof | null {
  if (!providerId(receipt?.id) || receipt.payment_id !== row.squarePaymentId
    || receipt.amount_money?.currency !== 'USD'
    || receipt.amount_money.amount !== row.refundAmountCents
    || !['PENDING', 'COMPLETED', 'REJECTED', 'FAILED'].includes(receipt.status ?? '')
    || (row.squareRefundId !== null && receipt.id !== row.squareRefundId)) return null;
  return {
    id: receipt.id,
    status: receipt.status as SquareRefundProof['status'],
    paymentId: receipt.payment_id,
    amountCents: receipt.amount_money.amount,
    currency: 'USD',
  };
}

export function paymentRemediationRetryAt(now: Date, attemptCount: number): string {
  const baseMs = 5 * 60 * 1_000;
  const maxMs = 24 * 60 * 60 * 1_000;
  const exponent = Math.min(8, Math.max(0, attemptCount - 1));
  return new Date(now.getTime() + Math.min(maxMs, baseMs * (2 ** exponent))).toISOString();
}
