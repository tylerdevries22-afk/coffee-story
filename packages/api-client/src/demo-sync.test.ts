import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import {
  createDemoSyncClient,
  resolveDemoSyncBaseUrl,
  resolveDemoSyncRuntimeUrl,
} from './demo-sync';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('resolveDemoSyncBaseUrl', () => {
  it('accepts only plain HTTP loopback URLs without embedded credentials', () => {
    assert.equal(resolveDemoSyncBaseUrl('http://localhost:3300/api/demo-sync/'), 'http://localhost:3300/api/demo-sync');
    assert.equal(resolveDemoSyncBaseUrl('https://localhost/api/demo-sync'), null);
    assert.equal(resolveDemoSyncBaseUrl('http://demo.example/api/demo-sync'), null);
    assert.equal(resolveDemoSyncBaseUrl('http://user:pass@localhost/api/demo-sync'), null);
  });
});

describe('resolveDemoSyncRuntimeUrl', () => {
  it('prefers a configured loopback URL', () => {
    assert.equal(
      resolveDemoSyncRuntimeUrl('http://127.0.0.1:3400/api/demo-sync', {
        hostname: 'localhost',
        protocol: 'http:',
      }),
      'http://127.0.0.1:3400/api/demo-sync',
    );
  });

  it('derives the broker from a local HTTP preview origin', () => {
    assert.equal(
      resolveDemoSyncRuntimeUrl(undefined, { hostname: 'localhost', protocol: 'http:' }),
      'http://localhost:3300/api/demo-sync',
    );
    assert.equal(
      resolveDemoSyncRuntimeUrl(undefined, { hostname: '127.0.0.1', protocol: 'http:' }),
      'http://127.0.0.1:3300/api/demo-sync',
    );
  });

  it('does not infer a broker for hosted or HTTPS origins', () => {
    assert.equal(
      resolveDemoSyncRuntimeUrl('https://demo.example/api/demo-sync', {
        hostname: 'localhost',
        protocol: 'http:',
      }),
      null,
    );
    assert.equal(
      resolveDemoSyncRuntimeUrl(undefined, { hostname: 'demo.example', protocol: 'http:' }),
      null,
    );
    assert.equal(
      resolveDemoSyncRuntimeUrl(undefined, { hostname: 'localhost', protocol: 'https:' }),
      null,
    );
  });
});

describe('createDemoSyncClient', () => {
  it('refuses an unsafe destination and sends idempotent orders to loopback', async () => {
    assert.equal(createDemoSyncClient('https://demo.example/api/demo-sync', 'kiosk'), null);
    const calls: { url: string; init: RequestInit }[] = [];
    globalThis.fetch = async (input, init) => {
      calls.push({ url: String(input), init: init ?? {} });
      return Response.json({
        orderId: 'order-1', status: 'paid', subtotalCents: 500,
        taxCents: 0, tipCents: 0, totalCents: 500, dailyNumber: 51,
      });
    };
    const client = createDemoSyncClient('http://127.0.0.1:3300/api/demo-sync', 'kiosk');
    assert.ok(client);
    await client.placeOrder({
      locationId: 'demo', fulfillmentType: 'pickup', tenderType: 'pay_at_pickup',
      lines: [{ itemSlug: 'latte', quantity: 1 }], tipCents: 0,
    }, '0a58a8fc-13fc-48ca-b8c0-a458c8b2995c');
    assert.equal(calls[0]?.url, 'http://127.0.0.1:3300/api/demo-sync/orders');
    assert.equal(new Headers(calls[0]?.init.headers).get('x-demo-sync-channel'), 'kiosk');
    assert.equal(new Headers(calls[0]?.init.headers).get('idempotency-key'), '0a58a8fc-13fc-48ca-b8c0-a458c8b2995c');
    await client.board();
    assert.equal(calls[1]?.url, 'http://127.0.0.1:3300/api/demo-sync/board');
    await client.transition('order-1', 'paid');
    assert.equal(new Headers(calls[2]?.init.headers).get('x-demo-sync-channel'), 'kiosk');
    assert.ok(new Headers(calls[2]?.init.headers).get('idempotency-key'));
  });

  it('preserves the display-safe projection when an older preview lacks /board', async () => {
    let requests = 0;
    globalThis.fetch = async () => {
      requests += 1;
      if (requests === 1) return Response.json({ error: { code: 'not_found', message: 'Not found.' } }, { status: 404 });
      return Response.json({ sessionId: 'session-1', revision: 2, orders: [{
        id: 'order-1', channel: 'kiosk', dailyNumber: 51, fulfillmentType: 'pickup', guestName: 'Ada', status: 'ready', updatedAt: '2026-09-01T00:00:00.000Z',
      }] });
    };
    const client = createDemoSyncClient('http://localhost:3300/api/demo-sync', 'pos');
    assert.ok(client);
    assert.deepEqual(await client.board(), [{
      id: 'order-1', channel: 'kiosk', dailyNumber: 51, fulfillmentType: 'pickup', guestName: 'Ada', status: 'ready', updatedAt: '2026-09-01T00:00:00.000Z',
    }]);
    assert.equal(requests, 2);
  });
});
