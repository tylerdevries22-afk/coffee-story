import assert from 'node:assert/strict';
import test from 'node:test';

import { track, type AnalyticsEventContext } from './analytics';
import { createSessionHash } from './identity';
import { parseStoredQueue, serializeQueue, type AnalyticsQueueStore, type QueuedEvent } from './queue-store';
import { createAnalyticsTransport } from './transport';

const BRAND_ID = 'e627d6c2-6cb9-4368-8543-abd02a5afb7c';
const ENDPOINT = 'https://hq.example.com/api/analytics/events';

function context(sessionHash = createSessionHash(() => 0.2)): AnalyticsEventContext {
  return {
    brandId: BRAND_ID,
    surface: 'customer',
    appVersion: '1.0.0',
    sessionHash,
    consent: { essential: true, behavioral: true, source: 'user', updatedAt: '2026-08-27T18:00:00.000Z' },
  };
}

function event(index: number) {
  const value = track(context(), {
    clientEventId: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    occurredAt: '2026-08-27T18:00:00.000Z',
    eventName: 'screen.viewed',
    properties: { screenKey: 'home' },
  });
  assert.ok(value);
  return value;
}

/**
 * A store backed by one string, which is what a file is once the atomicity in
 * queue-store.ts has done its job. Killing the transport and building a new one
 * over the same disk is exactly an app restart.
 */
function memoryStore(): AnalyticsQueueStore & { disk: () => string | null; writes: () => number } {
  let contents: string | null = null;
  let writes = 0;
  return Object.freeze({
    load: async (): Promise<readonly QueuedEvent[]> => parseStoredQueue(contents),
    save: async (queue: readonly QueuedEvent[]) => { writes += 1; contents = serializeQueue(queue); },
    clear: async () => { contents = null; },
    disk: () => contents,
    writes: () => writes,
  });
}

test('transport batches at 50 and sends bearer plus idempotency', async () => {
  const calls: { body: string; headers: Headers }[] = [];
  const transport = createAnalyticsTransport({
    endpoint: ENDPOINT,
    getAccessToken: async () => 'access-token',
    createId: () => '10000000-0000-4000-8000-000000000001',
    flushDelayMs: 60_000,
    fetcher: async (_input, init) => {
      calls.push({ body: String(init?.body), headers: new Headers(init?.headers) });
      return new Response(null, { status: 202 });
    },
  });
  for (let index = 1; index <= 51; index += 1) transport.enqueue(event(index));
  const result = await transport.flush();
  assert.equal(result.accepted, 50);
  assert.equal(transport.queuedCount(), 1);
  assert.equal(JSON.parse(calls[0]?.body ?? '{}').events.length, 50);
  assert.equal(calls[0]?.headers.get('authorization'), 'Bearer access-token');
  assert.equal(calls[0]?.headers.get('idempotency-key'), '10000000-0000-4000-8000-000000000001');
  transport.dispose();
});

test('transport retries once with the same idempotency key', async () => {
  let calls = 0;
  const keys: string[] = [];
  const transport = createAnalyticsTransport({
    endpoint: ENDPOINT,
    getAccessToken: async () => 'access-token',
    createId: () => '10000000-0000-4000-8000-000000000002',
    sleep: async () => undefined,
    flushDelayMs: 60_000,
    fetcher: async (_input, init) => {
      calls += 1;
      keys.push(new Headers(init?.headers).get('idempotency-key') ?? '');
      return new Response(null, { status: calls === 1 ? 503 : 202 });
    },
  });
  transport.enqueue(event(1));
  const result = await transport.flush();
  assert.equal(result.status, 'accepted');
  assert.equal(calls, 2);
  assert.deepEqual(keys, [keys[0], keys[0]]);
  transport.dispose();
});

test('transport retains offline events, expires stale events, and bounds its queue', async () => {
  let now = 1_000;
  const transport = createAnalyticsTransport({
    endpoint: 'http://localhost:3300/api/analytics/events',
    getAccessToken: async () => null,
    now: () => now,
    maxAgeMs: 100,
    maxQueueSize: 2,
    flushDelayMs: 60_000,
  });
  transport.enqueue(event(1));
  transport.enqueue(event(2));
  transport.enqueue(event(3));
  assert.equal(transport.queuedCount(), 2);
  assert.equal((await transport.flush()).status, 'offline');
  now = 1_101;
  assert.equal(transport.queuedCount(), 0);
  transport.dispose();
});

test('transport drops a rejected batch so later events are not blocked', async () => {
  const transport = createAnalyticsTransport({
    endpoint: ENDPOINT,
    getAccessToken: async () => 'access-token',
    createId: () => '10000000-0000-4000-8000-000000000003',
    flushDelayMs: 60_000,
    fetcher: async () => new Response(null, { status: 400 }),
  });
  transport.enqueue(event(1));
  assert.equal((await transport.flush()).status, 'rejected');
  assert.equal(transport.queuedCount(), 0);
  transport.dispose();
});

test('transport rejects insecure non-loopback endpoints', () => {
  assert.throws(() => createAnalyticsTransport({
    endpoint: 'http://hq.example.com/api/analytics/events',
    getAccessToken: async () => null,
  }), /HTTPS/);
});

/** The defect this store exists for: a kill used to take every buffered event with it. */
test('transport restores its queue after the process dies', async () => {
  const store = memoryStore();
  const options = {
    endpoint: ENDPOINT,
    getAccessToken: async () => null,
    flushDelayMs: 60_000,
    store,
  };
  const before = createAnalyticsTransport(options);
  before.enqueue(event(1));
  before.enqueue(event(2));
  await before.settled();
  // No dispose: the process was killed, which is the case that used to lose
  // everything. Nothing gets a chance to flush or tidy up.

  const after = createAnalyticsTransport(options);
  await after.settled();
  assert.equal(after.queuedCount(), 2);
  after.dispose();
});

/**
 * The narrow window the persist chain waits on hydration for: an event
 * arriving before the stored queue is read back used to write a snapshot
 * without the restored events, so a kill right then lost them.
 */
test('an event enqueued before hydration lands never overwrites the stored queue', async () => {
  const store = memoryStore();
  const options = {
    endpoint: ENDPOINT,
    getAccessToken: async () => null,
    flushDelayMs: 60_000,
    store,
  };
  const before = createAnalyticsTransport(options);
  before.enqueue(event(1));
  await before.settled();

  const after = createAnalyticsTransport({
    ...options,
    // Reading the queue back is slow enough that the enqueue below happens
    // first, which is the ordering a real file read produces on launch.
    store: { ...store, load: async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return store.load();
    } },
  });
  after.enqueue(event(2));
  await after.settled();
  assert.deepEqual(parseStoredQueue(store.disk()).map((item) => item.event.clientEventId),
    [event(1).clientEventId, event(2).clientEventId]);
  after.dispose();
});

test('a restored queue keeps FIFO order in front of events queued since launch', async () => {
  const store = memoryStore();
  const sent: string[] = [];
  const options = {
    endpoint: ENDPOINT,
    getAccessToken: async () => 'access-token',
    createId: () => '10000000-0000-4000-8000-000000000004',
    flushDelayMs: 60_000,
    store,
  };
  const before = createAnalyticsTransport({ ...options, getAccessToken: async () => null });
  before.enqueue(event(1));
  await before.settled();

  const after = createAnalyticsTransport({
    ...options,
    fetcher: async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as { events: { clientEventId: string }[] };
      sent.push(...body.events.map((value) => value.clientEventId));
      return new Response(null, { status: 202 });
    },
  });
  after.enqueue(event(2));
  await after.flush();
  assert.deepEqual(sent, [event(1).clientEventId, event(2).clientEventId]);
  after.dispose();
});

test('the stored queue shrinks as events are accepted', async () => {
  const store = memoryStore();
  const transport = createAnalyticsTransport({
    endpoint: ENDPOINT,
    getAccessToken: async () => 'access-token',
    createId: () => '10000000-0000-4000-8000-000000000005',
    flushDelayMs: 60_000,
    fetcher: async () => new Response(null, { status: 202 }),
    store,
  });
  transport.enqueue(event(1));
  await transport.settled();
  assert.equal(parseStoredQueue(store.disk()).length, 1);
  await transport.flush();
  await transport.settled();
  assert.deepEqual(parseStoredQueue(store.disk()), []);
  transport.dispose();
});

/** Persistence changes what survives a restart, never how much is retained. */
test('persistence keeps the existing bounds and eviction order', async () => {
  let now = 1_000;
  const store = memoryStore();
  const options = {
    endpoint: 'http://localhost:3300/api/analytics/events',
    getAccessToken: async () => null,
    now: () => now,
    maxAgeMs: 100,
    maxQueueSize: 2,
    flushDelayMs: 60_000,
    store,
  };
  const before = createAnalyticsTransport(options);
  before.enqueue(event(1));
  before.enqueue(event(2));
  before.enqueue(event(3));
  await before.settled();
  // The oldest was evicted before the write, so it is not on disk either.
  assert.deepEqual(parseStoredQueue(store.disk()).map((item) => item.event.clientEventId),
    [event(2).clientEventId, event(3).clientEventId]);

  now = 1_101;
  const after = createAnalyticsTransport(options);
  await after.settled();
  // Restored events are still subject to the 24-hour rule; these are stale.
  assert.equal(after.queuedCount(), 0);
  after.dispose();
});

test('dispose leaves the stored queue for the next launch, purge erases it', async () => {
  const store = memoryStore();
  const options = {
    endpoint: ENDPOINT,
    getAccessToken: async () => null,
    flushDelayMs: 60_000,
    store,
  };
  const first = createAnalyticsTransport(options);
  first.enqueue(event(1));
  await first.settled();
  first.dispose();
  assert.equal(parseStoredQueue(store.disk()).length, 1);

  const second = createAnalyticsTransport(options);
  await second.purge();
  assert.equal(second.queuedCount(), 0);
  assert.equal(store.disk(), null);
  second.dispose();
});

test('a store that cannot be read or written never breaks the transport', async () => {
  const broken: AnalyticsQueueStore = Object.freeze({
    load: async () => { throw new Error('unreadable'); },
    save: async () => { throw new Error('unwritable'); },
    clear: async () => { throw new Error('unremovable'); },
  });
  const transport = createAnalyticsTransport({
    endpoint: ENDPOINT,
    getAccessToken: async () => 'access-token',
    createId: () => '10000000-0000-4000-8000-000000000006',
    flushDelayMs: 60_000,
    fetcher: async () => new Response(null, { status: 202 }),
    store: broken,
  });
  transport.enqueue(event(1));
  await transport.settled();
  assert.equal((await transport.flush()).status, 'accepted');
  await transport.purge();
  transport.dispose();
});
