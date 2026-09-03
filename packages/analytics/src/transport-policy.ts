/**
 * The transport's delivery policy: what it will accept as an endpoint, how much
 * it will hold, and which failures are worth a second attempt.
 *
 * Separated from `transport.ts` when the queue gained durable storage, purely
 * so both stay inside the file-size rule. The numbers themselves are unchanged
 * -- persistence decides what survives a restart, not how much is retained.
 */

const DEFAULT_MAX_QUEUE_SIZE = 200;
const DEFAULT_MAX_AGE_MS = 24 * 60 * 60 * 1_000;
const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_FLUSH_DELAY_MS = 1_000;

export type AnalyticsTransportLimits = Readonly<{
  maxQueueSize?: number;
  maxAgeMs?: number;
  timeoutMs?: number;
  flushDelayMs?: number;
}>;

export type AnalyticsTransportBounds = Readonly<{
  url: string;
  maxQueueSize: number;
  maxAgeMs: number;
  timeoutMs: number;
  flushDelayMs: number;
}>;

/** Validates the endpoint and the bounds together, so a bad transport never exists. */
export function checkedTransportBounds(
  endpoint: string,
  limits: AnalyticsTransportLimits,
): AnalyticsTransportBounds {
  const url = new URL(endpoint);
  const isLocal = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  if (url.protocol !== 'https:' && !(isLocal && url.protocol === 'http:')) {
    throw new Error('Analytics endpoint must use HTTPS outside loopback development.');
  }
  const maxQueueSize = limits.maxQueueSize ?? DEFAULT_MAX_QUEUE_SIZE;
  const maxAgeMs = limits.maxAgeMs ?? DEFAULT_MAX_AGE_MS;
  const timeoutMs = limits.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const flushDelayMs = limits.flushDelayMs ?? DEFAULT_FLUSH_DELAY_MS;
  if (![maxQueueSize, maxAgeMs, timeoutMs, flushDelayMs].every((value) => Number.isInteger(value) && value > 0)) {
    throw new Error('Analytics transport bounds must be positive integers.');
  }
  return Object.freeze({ url: url.toString(), maxQueueSize, maxAgeMs, timeoutMs, flushDelayMs });
}

export function retryableStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

export function defaultSleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
