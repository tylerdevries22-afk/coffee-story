import {
  MAX_BATCH_EVENTS,
  createAnalyticsBatch,
  type AnalyticsEventEnvelope,
} from './analytics';
import { ANALYTICS_UUID_PATTERN, createAnalyticsId } from './identity';
import type { AnalyticsQueueStore, QueuedEvent } from './queue-store';
import {
  checkedTransportBounds,
  defaultSleep,
  retryableStatus,
  type AnalyticsTransportLimits,
} from './transport-policy';

export type AnalyticsTransportResult = Readonly<{
  accepted: number;
  queued: number;
  status: 'accepted' | 'empty' | 'offline' | 'rejected';
}>;

export type AnalyticsTransportOptions = AnalyticsTransportLimits & Readonly<{
  endpoint: string;
  getAccessToken: () => Promise<string | null>;
  fetcher?: typeof fetch;
  now?: () => number;
  random?: () => number;
  createId?: () => string;
  sleep?: (milliseconds: number) => Promise<void>;
  /** Durable backing. Omitted, the queue behaves exactly as it always has. */
  store?: AnalyticsQueueStore;
}>;

export type AnalyticsTransport = Readonly<{
  enqueue: (event: AnalyticsEventEnvelope) => void;
  flush: () => Promise<AnalyticsTransportResult>;
  queuedCount: () => number;
  dispose: () => void;
  /** Resolves once the stored queue is read back and every write has landed. */
  settled: () => Promise<void>;
  /** Forgets the queue in memory and on disk: sign-out, or consent withdrawn. */
  purge: () => Promise<void>;
}>;

/**
 * Creates a bounded, non-blocking analytics queue. Failed authentication or
 * network delivery keeps unexpired events queued; invalid batches are dropped
 * so one corrupt event cannot permanently block later telemetry.
 *
 * Given a `store` the queue also survives the process. The bounds are
 * unchanged by that -- 200 events, 24 hours, oldest evicted first -- because
 * persistence is about surviving a restart, not about keeping more for longer.
 */
export function createAnalyticsTransport(options: AnalyticsTransportOptions): AnalyticsTransport {
  const bounds = checkedTransportBounds(options.endpoint, options);
  const fetcher = options.fetcher ?? fetch;
  const now = options.now ?? Date.now;
  const random = options.random ?? Math.random;
  const createId = options.createId ?? (() => createAnalyticsId(random));
  const sleep = options.sleep ?? defaultSleep;
  const store = options.store ?? null;
  let queue: QueuedEvent[] = [];
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;
  let inFlight: Promise<AnalyticsTransportResult> | null = null;
  let persistence: Promise<void> = Promise.resolve();

  const removeExpired = () => {
    const cutoff = now() - bounds.maxAgeMs;
    queue = queue.filter((item) => item.queuedAt >= cutoff);
  };

  const hydration: Promise<void> = store
    ? store.load().then((restored) => {
      if (disposed || restored.length === 0) return;
      // Restored events predate anything enqueued since launch, so they go in
      // front: the queue stays FIFO across a restart, and the oldest are still
      // the first evicted when the bound bites.
      queue = [...restored, ...queue];
      removeExpired();
      if (queue.length > bounds.maxQueueSize) queue.splice(0, queue.length - bounds.maxQueueSize);
    }).catch(() => undefined)
    : Promise.resolve();

  // Serialized, and never ahead of hydration. An event enqueued before the
  // stored queue is read back -- every launch, since the surface observer
  // fires on mount -- would otherwise write a snapshot missing the restored
  // events, and a kill in that window loses exactly what this exists to keep.
  // The queue is read when a write takes its turn rather than when it was
  // asked for, so the last write still reflects the newest state. A failed
  // write is swallowed: telemetry may not break the app.
  const persist = () => {
    if (!store || disposed) return;
    persistence = persistence
      .then(() => hydration)
      .then(() => store.save(queue.slice()))
      .catch(() => undefined);
  };

  const schedule = () => {
    if (disposed || flushTimer || queue.length === 0) return;
    flushTimer = setTimeout(() => {
      flushTimer = null;
      void flush();
    }, bounds.flushDelayMs);
  };

  const deliver = async (): Promise<AnalyticsTransportResult> => {
    // A flush that raced hydration would send a partial batch and then have
    // the restored events reappear behind it, out of order.
    await hydration;
    removeExpired();
    if (queue.length === 0) return { accepted: 0, queued: 0, status: 'empty' };
    const selected = queue.slice(0, MAX_BATCH_EVENTS);
    const batch = createAnalyticsBatch(selected.map((item) => item.event));
    const accessToken = await options.getAccessToken().catch(() => null);
    if (!accessToken) return { accepted: 0, queued: queue.length, status: 'offline' };
    const idempotencyKey = createId();
    if (!ANALYTICS_UUID_PATTERN.test(idempotencyKey)) throw new Error('Analytics createId must return a UUIDv4.');

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
          persist();
          schedule();
          return { accepted: selected.length, queued: queue.length, status: 'accepted' };
        }
        if (!retryableStatus(response.status)) {
          queue.splice(0, selected.length);
          persist();
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

  const settled = async (): Promise<void> => {
    await hydration;
    await persistence;
  };

  return Object.freeze({
    enqueue: (event: AnalyticsEventEnvelope) => {
      if (disposed) return;
      removeExpired();
      queue.push({ event, queuedAt: now() });
      if (queue.length > bounds.maxQueueSize) queue.splice(0, queue.length - bounds.maxQueueSize);
      persist();
      if (queue.length >= MAX_BATCH_EVENTS) void flush();
      else schedule();
    },
    flush,
    // Synchronous by contract, so it reads low until hydration lands.
    queuedCount: () => {
      removeExpired();
      return queue.length;
    },
    // Teardown, not erasure: the queue is meant to outlive the process, so
    // this leaves the file alone. `purge` is the erasure path.
    dispose: () => {
      disposed = true;
      if (flushTimer) clearTimeout(flushTimer);
      flushTimer = null;
      queue = [];
    },
    settled,
    purge: async () => {
      await hydration;
      queue = [];
      if (!store) return;
      persistence = persistence.then(() => store.clear()).catch(() => undefined);
      await persistence;
    },
  });
}
