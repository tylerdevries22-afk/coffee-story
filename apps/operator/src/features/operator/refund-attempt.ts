import { ApiError, newIdempotencyKey } from '@platform/api-client';

export type RefundAmount = number | 'full';

export type RefundAttempt = {
  orderId: string;
  amountCents: RefundAmount;
  idempotencyKey: string;
};

export type RefundAttemptStorage = {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
  removeItem: (key: string) => Promise<void>;
};

export class RefundAttemptError extends Error {
  readonly code: 'amount_changed' | 'storage_unavailable';

  constructor(code: RefundAttemptError['code'], message: string) {
    super(message);
    this.name = 'RefundAttemptError';
    this.code = code;
  }
}

const VERSION = 1;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function storageKey(orderId: string): string {
  return `platform:operator-refund-attempt:${orderId}`;
}

function isRefundAmount(value: unknown): value is RefundAmount {
  return value === 'full' || (typeof value === 'number' && Number.isInteger(value) && value > 0);
}

function parseAttempt(raw: string, orderId: string): RefundAttempt {
  try {
    const parsed = JSON.parse(raw) as {
      version?: unknown;
      orderId?: unknown;
      amountCents?: unknown;
      idempotencyKey?: unknown;
    };
    if (
      parsed.version === VERSION
      && parsed.orderId === orderId
      && isRefundAmount(parsed.amountCents)
      && typeof parsed.idempotencyKey === 'string'
      && UUID.test(parsed.idempotencyKey)
    ) {
      return {
        orderId,
        amountCents: parsed.amountCents,
        idempotencyKey: parsed.idempotencyKey,
      };
    }
  } catch {
    // Fail closed below. Replacing an unreadable attempt could refund twice.
  }
  throw new RefundAttemptError(
    'storage_unavailable',
    'The saved refund attempt could not be verified. No refund was sent.',
  );
}

async function loadOrCreateAttempt(
  storage: RefundAttemptStorage,
  orderId: string,
  amountCents: RefundAmount,
): Promise<RefundAttempt> {
  let raw: string | null;
  try {
    raw = await storage.getItem(storageKey(orderId));
  } catch {
    throw new RefundAttemptError('storage_unavailable', 'Refund safety storage is unavailable. No refund was sent.');
  }
  if (raw) {
    const existing = parseAttempt(raw, orderId);
    if (existing.amountCents !== amountCents) {
      const amount = existing.amountCents === 'full' ? 'the full amount' : `${existing.amountCents} cents`;
      throw new RefundAttemptError(
        'amount_changed',
        `A prior refund of ${amount} has an uncertain outcome. Retry that same amount before starting another refund.`,
      );
    }
    return existing;
  }

  const attempt = { orderId, amountCents, idempotencyKey: newIdempotencyKey() } satisfies RefundAttempt;
  try {
    await storage.setItem(storageKey(orderId), JSON.stringify({ version: VERSION, ...attempt }));
  } catch {
    throw new RefundAttemptError('storage_unavailable', 'Refund safety storage is unavailable. No refund was sent.');
  }
  return attempt;
}

async function clearMatchingAttempt(
  storage: RefundAttemptStorage,
  attempt: RefundAttempt,
): Promise<void> {
  try {
    const raw = await storage.getItem(storageKey(attempt.orderId));
    if (!raw || parseAttempt(raw, attempt.orderId).idempotencyKey !== attempt.idempotencyKey) return;
    await storage.removeItem(storageKey(attempt.orderId));
  } catch {
    // Keeping a stale key is safe: the next call replays the completed attempt.
  }
}

/** Local fail-closed checks and non-5xx server rejections prove this submission did not run. */
export function refundFailureIsConclusive(error: unknown): boolean {
  return error instanceof RefundAttemptError || (error instanceof ApiError && error.status < 500);
}

/**
 * Persists before money moves, and removes only after a confirmed response or
 * a definite client rejection. Network loss and 5xx responses retain the key.
 */
export async function runRefundAttempt<T>(
  storage: RefundAttemptStorage,
  input: { orderId: string; amountCents: RefundAmount },
  submit: (idempotencyKey: string) => Promise<T>,
): Promise<T> {
  const attempt = await loadOrCreateAttempt(storage, input.orderId, input.amountCents);
  try {
    const result = await submit(attempt.idempotencyKey);
    await clearMatchingAttempt(storage, attempt);
    return result;
  } catch (error) {
    if (refundFailureIsConclusive(error)) await clearMatchingAttempt(storage, attempt);
    throw error;
  }
}
