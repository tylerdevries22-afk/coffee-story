import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { recordPlatformAccessEvent, type PlatformAccessEvent } from './platform-access';

const event: PlatformAccessEvent = {
  action: 'workspace.location.select',
  actorId: '11111111-1111-4111-8111-111111111111',
  brandId: '22222222-2222-4222-8222-222222222222',
  correlationId: '33333333-3333-4333-8333-333333333333',
  locationId: '44444444-4444-4444-8444-444444444444',
  metadata: { source: 'workspace_switcher', surface: 'hq' },
};

const environment = {
  url: 'https://project.supabase.co',
  serviceRoleKey: 'service-role-for-test',
};

describe('recordPlatformAccessEvent', () => {
  it('retries a transient RPC with one stable HTTP and database idempotency key', async () => {
    const originalFetch = globalThis.fetch;
    const requests: { body: string; key: string | null }[] = [];
    globalThis.fetch = async (_input, init) => {
      requests.push({
        body: String(init?.body ?? ''),
        key: new Headers(init?.headers).get('idempotency-key'),
      });
      return requests.length === 1
        ? new Response('{"message":"busy"}', { status: 503 })
        : new Response(null, { status: 204 });
    };
    try {
      assert.deepEqual(await recordPlatformAccessEvent(environment, event), { ok: true });
      assert.equal(requests.length, 2);
      assert.deepEqual(requests.map(({ key }) => key), [event.correlationId, event.correlationId]);
      assert.equal(requests[0]?.body, requests[1]?.body);
      assert.match(requests[0]?.body ?? '', new RegExp(event.correlationId));
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('rejects malformed identifiers before creating a privileged request', async () => {
    const originalFetch = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = async () => {
      calls += 1;
      return new Response(null, { status: 204 });
    };
    try {
      assert.deepEqual(
        await recordPlatformAccessEvent(environment, { ...event, brandId: '../foreign' }),
        { ok: false, errorCode: 'invalid_event', reason: 'invalid_event' },
      );
      assert.equal(calls, 0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('returns a safe failure after the bounded retry budget is exhausted', async () => {
    const originalFetch = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = async () => {
      calls += 1;
      throw new Error('sensitive network detail');
    };
    try {
      assert.deepEqual(
        await recordPlatformAccessEvent(environment, event),
        { ok: false, errorCode: 'unavailable', reason: 'rpc_unavailable' },
      );
      assert.equal(calls, 2);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
