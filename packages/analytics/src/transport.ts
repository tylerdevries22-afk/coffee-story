import {
  MAX_BATCH_EVENTS,
  createAnalyticsBatch,
  track,
  type AnalyticsEventContext,
  type AnalyticsEventEnvelope,
} from './analytics';

const DEFAULT_MAX_QUEUE_SIZE = 200;
const DEFAULT_MAX_AGE_MS = 24 * 60 * 60 * 1_000;
const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_FLUSH_DELAY_MS = 1_000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TENANT_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type AnalyticsTransportResult = Readonly<{
  accepted: number;
  queued: number;
  status: 'accepted' | 'empty' | 'offline' | 'rejected';
}>;

export type AnalyticsTransportOptions = Readonly<{
  endpoint: string;
  getAccessToken: () => Promise<string | null>;
  fetcher?: typeof fetch;
  now?: () => number;
  random?: () => number;
  createId?: () => string;
  sleep?: (milliseconds: number) => Promise<void>;
  maxQueueSize?: number;
  maxAgeMs?: number;
  timeoutMs?: number;
  flushDelayMs?: number;
}>;

export type AnalyticsTransport = Readonly<{
  enqueue: (event: AnalyticsEventEnvelope) => void;
  flush: () => Promise<AnalyticsTransportResult>;
  queuedCount: () => number;
  dispose: () => void;
}>;

export type AnalyticsSurfaceObservation = Readonly<{
  context: Omit<AnalyticsEventContext, 'sessionHash'>;
  screenKey: string;
  sessionIdentity: string;
}>;

export type AnalyticsSurfaceObserver = Readonly<{
  observe: (observation: AnalyticsSurfaceObservation) => number;
}>;

type QueuedEvent = Readonly<{ event: AnalyticsEventEnvelope; queuedAt: number }>;

function randomBytes(length: number, random?: () => number): number[] {
  if (!random && globalThis.crypto?.getRandomValues) {
    return Array.from(globalThis.crypto.getRandomValues(new Uint8Array(length)));
  }
  const source = random ?? Math.random;
  return Array.from({ length }, () => Math.floor(source() * 256));
}

/** Creates a UUIDv4 for event and batch idempotency without adding a runtime dependency. */
export function createAnalyticsId(random?: () => number): string {
  if (!random && globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  const bytes = randomBytes(16, random);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.map((value) => value.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Creates a rotating, non-identifying session correlation value. */
export function createSessionHash(random?: () => number): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-';
  return `h1_${randomBytes(32, random).map((value) => alphabet[value % alphabet.length] ?? 'A').join('')}`;
}

/** Returns one allowlisted screen key; unmatched or parameterized paths never leave the app. */
export function screenKeyFor(
  pathname: string,
  allowlist: Readonly<Record<string, string>>,
): string {
  const normalized = `/${pathname.split(/[?#]/, 1)[0]?.split('/').filter(Boolean).join('/') ?? ''}`;
  return allowlist[normalized] ?? 'unknown';
}

/**
 * Reads the tenant hint embedded by the Supabase access-token hook. This does
 * not authenticate the JWT; the ingestion server verifies the bearer and
 * derives tenancy again before accepting an event.
 */
export function tenantIdHintFromJwt(accessToken: string): string | null {
  try {
    const payload = accessToken.split('.')[1];
    if (!payload) return null;
    const normalized = payload.replaceAll('-', '+').replaceAll('_', '/');
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    let decode = '';
    let bits = 0;
    let bitCount = 0;
    for (const character of normalized.replace(/=+$/, '')) {
      const value = alphabet.indexOf(character);
      if (value < 0) return null;
      bits = (bits << 6) | value;
      bitCount += 6;
      if (bitCount >= 8) {
        bitCount -= 8;
        decode += String.fromCharCode((bits >> bitCount) & 0xff);
      }
    }
    const parsed = JSON.parse(decode) as { app_metadata?: { brand_id?: unknown } };
    const brandId = parsed.app_metadata?.brand_id;
    return typeof brandId === 'string' && TENANT_UUID_PATTERN.test(brandId) ? brandId : null;
  } catch {
    return null;
  }
}

function checkedOptions(options: AnalyticsTransportOptions) {
  const url = new URL(options.endpoint);
  const isLocal = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  if (url.protocol !== 'https:' && !(isLocal && url.protocol === 'http:')) {
    throw new Error('Analytics endpoint must use HTTPS outside loopback development.');
  }
  const maxQueueSize = options.maxQueueSize ?? DEFAULT_MAX_QUEUE_SIZE;
  const maxAgeMs = options.maxAgeMs ?? DEFAULT_MAX_AGE_MS;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const flushDelayMs = options.flushDelayMs ?? DEFAULT_FLUSH_DELAY_MS;
  if (![maxQueueSize, maxAgeMs, timeoutMs, flushDelayMs].every((value) => Number.isInteger(value) && value > 0)) {
    throw new Error('Analytics transport bounds must be positive integers.');
  }
  return { url: url.toString(), maxQueueSize, maxAgeMs, timeoutMs, flushDelayMs };
}

function retryableStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function defaultSleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/**
 * Creates a bounded, non-blocking analytics queue. Failed authentication or
 * network delivery keeps unexpired events queued; invalid batches are dropped
 * so one corrupt event cannot permanently block later telemetry.
 */
export function createAnalyticsTransport(options: AnalyticsTransportOptions): AnalyticsTransport {
  const bounds = checkedOptions(options);
  const fetcher = options.fetcher ?? fetch;
  const now = options.now ?? Date.now;
  const random = options.random ?? Math.random;
  const createId = options.createId ?? (() => createAnalyticsId(random));
  const sleep = options.sleep ?? defaultSleep;
  let queue: QueuedEvent[] = [];
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;
  let inFlight: Promise<AnalyticsTransportResult> | null = null;

  const removeExpired = () => {
    const cutoff = now() - bounds.maxAgeMs;
    queue = queue.filter((item) => item.queuedAt >= cutoff);
  };

  const schedule = () => {
    if (disposed || flushTimer || queue.length === 0) return;
    flushTimer = setTimeout(() => {
      flushTimer = null;
      void flush();
    }, bounds.flushDelayMs);
  };

  const deliver = async (): Promise<AnalyticsTransportResult> => {
    removeExpired();
    if (queue.length === 0) return { accepted: 0, queued: 0, status: 'empty' };
    const selected = queue.slice(0, MAX_BATCH_EVENTS);
    const batch = createAnalyticsBatch(selected.map((item) => item.event));
    const accessToken = await options.getAccessToken().catch(() => null);
    if (!accessToken) return { accepted: 0, queued: queue.length, status: 'offline' };
    const idempotencyKey = createId();
    if (!UUID_PATTERN.test(idempotencyKey)) throw new Error('Analytics createId must return a UUIDv4.');

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), bounds.timeoutMs);
      try {
        const response = await fetcher(bounds.url, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${accessToken}`,
            'content-type': 'application/json',
            'idempotency-key': idempotencyKey,
          },
          body: JSON.stringify(batch),
          signal: controller.signal,
        });
        if (response.ok) {
          queue.splice(0, selected.length);
          schedule();
          return { accepted: selected.length, queued: queue.length, status: 'accepted' };
        }
        if (!retryableStatus(response.status)) {
          queue.splice(0, selected.length);
          schedule();
          return { accepted: 0, queued: queue.length, status: 'rejected' };
        }
      } catch {
        // A timeout or network failure follows the same bounded retry path.
      } finally {
        clearTimeout(timeout);
      }
      if (attempt === 0) await sleep(100 + Math.floor(random() * 151));
    }
    return { accepted: 0, queued: queue.length, status: 'offline' };
  };

  const flush = (): Promise<AnalyticsTransportResult> => {
    if (inFlight) return inFlight;
    inFlight = deliver().finally(() => { inFlight = null; });
    return inFlight;
  };

  return Object.freeze({
    enqueue: (event: AnalyticsEventEnvelope) => {
      if (disposed) return;
      removeExpired();
      queue.push({ event, queuedAt: now() });
      if (queue.length > bounds.maxQueueSize) queue.splice(0, queue.length - bounds.maxQueueSize);
      if (queue.length >= MAX_BATCH_EVENTS) void flush();
      else schedule();
    },
    flush,
    queuedCount: () => {
      removeExpired();
      return queue.length;
    },
    dispose: () => {
      disposed = true;
      if (flushTimer) clearTimeout(flushTimer);
      flushTimer = null;
      queue = [];
    },
  });
}

/**
 * Deduplicates surface observations and rotates the pseudonymous session when
 * the authenticated user, paired device, consent state, or kiosk reset changes.
 */
export function createAnalyticsSurfaceObserver(
  transport: Pick<AnalyticsTransport, 'enqueue'>,
  dependencies: Readonly<{
    createId?: () => string;
    createSessionHash?: () => string;
    now?: () => Date;
  }> = {},
): AnalyticsSurfaceObserver {
  const createId = dependencies.createId ?? createAnalyticsId;
  const nextSessionHash = dependencies.createSessionHash ?? createSessionHash;
  const now = dependencies.now ?? (() => new Date());
  let sessionIdentity: string | null = null;
  let sessionHash = nextSessionHash();
  let lastScreen: string | null = null;

  return Object.freeze({
    observe: (observation) => {
      let emitted = 0;
      const occurredAt = now().toISOString();
      if (sessionIdentity !== observation.sessionIdentity) {
        sessionIdentity = observation.sessionIdentity;
        sessionHash = nextSessionHash();
        lastScreen = null;
        const event = track({ ...observation.context, sessionHash }, {
          clientEventId: createId(),
          occurredAt,
          eventName: 'session.started',
          properties: { entryPoint: observation.screenKey },
        });
        if (event) {
          transport.enqueue(event);
          emitted += 1;
        }
      }
      if (lastScreen !== observation.screenKey) {
        lastScreen = observation.screenKey;
        const event = track({ ...observation.context, sessionHash }, {
          clientEventId: createId(),
          occurredAt,
          eventName: 'screen.viewed',
          properties: { screenKey: observation.screenKey },
        });
        if (event) {
          transport.enqueue(event);
          emitted += 1;
        }
      }
      return emitted;
    },
  });
}
