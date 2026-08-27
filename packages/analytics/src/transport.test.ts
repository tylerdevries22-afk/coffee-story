import assert from 'node:assert/strict';
import test from 'node:test';

import { track, type AnalyticsEventContext } from './analytics';
import {
  createAnalyticsId,
  createAnalyticsSurfaceObserver,
  createAnalyticsTransport,
  createSessionHash,
  screenKeyFor,
  tenantIdHintFromJwt,
} from './transport';

const BRAND_ID = 'e627d6c2-6cb9-4368-8543-abd02a5afb7c';

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

test('createAnalyticsId creates a UUIDv4', () => {
  assert.match(createAnalyticsId(() => 0.25), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

test('createSessionHash creates a bounded versioned pseudonymous value', () => {
  assert.match(createSessionHash(() => 0.5), /^h1_[A-Za-z0-9_-]{32}$/);
});

test('screenKeyFor returns only allowlisted values', () => {
  const routes = { '/client/home': 'home' };
  assert.equal(screenKeyFor('/client/home?source=email', routes), 'home');
  assert.equal(screenKeyFor('/drops/private-campaign-name', routes), 'unknown');
});

test('tenantIdHintFromJwt reads only a valid hook-minted tenant hint', () => {
  const payload = Buffer.from(JSON.stringify({ app_metadata: { brand_id: BRAND_ID } })).toString('base64url');
  assert.equal(tenantIdHintFromJwt(`header.${payload}.signature`), BRAND_ID);
  assert.equal(tenantIdHintFromJwt('header.invalid.signature'), null);
});

test('transport batches at 50 and sends bearer plus idempotency', async () => {
  const calls: { body: string; headers: Headers }[] = [];
  const transport = createAnalyticsTransport({
    endpoint: 'https://hq.example.com/api/analytics/events',
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
    endpoint: 'https://hq.example.com/api/analytics/events',
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
    endpoint: 'https://hq.example.com/api/analytics/events',
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

test('surface observer emits a session once, deduplicates screens, and rotates identities', () => {
  const events: { eventName: string; properties: unknown }[] = [];
  const observer = createAnalyticsSurfaceObserver({
    enqueue: (value) => { events.push({ eventName: value.eventName, properties: value.properties }); },
  }, {
    createId: (() => {
      let id = 0;
      return () => `40000000-0000-4000-8000-${String(++id).padStart(12, '0')}`;
    })(),
    createSessionHash: () => 'h1_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    now: () => new Date('2026-08-27T18:00:00.000Z'),
  });
  const observation = {
    context: {
      brandId: BRAND_ID,
      surface: 'customer' as const,
      appVersion: '1.0.0',
      consent: { essential: true as const, behavioral: true, source: 'user' as const, updatedAt: '2026-08-27T18:00:00.000Z' },
    },
    screenKey: 'home',
    sessionIdentity: 'user-1:allowed',
  };
  assert.equal(observer.observe(observation), 2);
  assert.equal(observer.observe(observation), 0);
  assert.equal(observer.observe({ ...observation, screenKey: 'orders' }), 1);
  assert.equal(observer.observe({ ...observation, sessionIdentity: 'user-2:allowed' }), 2);
  assert.deepEqual(events.map((value) => value.eventName), [
    'session.started', 'screen.viewed', 'screen.viewed', 'session.started', 'screen.viewed',
  ]);
});
