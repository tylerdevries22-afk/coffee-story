import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { POST } from '../app/api/device-wall/heartbeat/route';
import { resetRateLimits } from './rate-limit';

const BRAND = '11111111-1111-4111-8111-111111111111';
const HERE = '22222222-2222-4222-8222-222222222222';
const ELSEWHERE = '33333333-3333-4333-8333-333333333333';
const INSTALLATION = '44444444-4444-4444-8444-444444444444';

const ENV = {
  SUPABASE_URL: 'https://database.example.test',
  SUPABASE_SERVICE_ROLE_KEY: 'test-service-key',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'test-anon-key',
};

/** A base64url JWT body with no signature: `authenticate` never checks one --
 *  verification happens against the mocked GoTrue endpoint below. */
const userToken = (metadata: unknown) =>
  `header.${Buffer.from(JSON.stringify({ app_metadata: metadata })).toString('base64url')}.sig`;

function heartbeatFetch(seen: { rpcCalled: boolean }) {
  return (async (input: RequestInfo | URL): Promise<Response> => {
    const path = new URL(String(input)).pathname;
    if (path.endsWith('/auth/v1/user')) {
      return Response.json({ id: 'user-1', email: 'staff@example.test' });
    }
    if (path.endsWith('/rpc/record_device_heartbeat')) {
      seen.rpcCalled = true;
      return Response.json(new Date().toISOString());
    }
    throw new Error(`Unexpected request path ${path}`);
  }) as typeof fetch;
}

async function withEnv(run: () => Promise<void>): Promise<void> {
  const previous = Object.fromEntries(Object.keys(ENV).map((key) => [key, process.env[key]]));
  Object.assign(process.env, ENV);
  delete process.env.SUPABASE_JWT_SECRET; // keeps authenticateAny on the user path, not the device one.
  resetRateLimits();
  const originalFetch = globalThis.fetch;
  try {
    await run();
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
}

function heartbeat(body: unknown, token: string): Request {
  return new Request('https://hq.example.test/api/device-wall/heartbeat', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/device-wall/heartbeat', () => {
  /**
   * This is the case the old check let through: for a user caller, `locationId`
   * was assigned from `body.locationId` and then compared against
   * `body.locationId` -- always equal, so the guard never fired. A guest
   * account (a brand but no staff role, per `parseTenantClaims`) could ring in
   * for any location it named.
   */
  it('refuses a role-less guest naming a location it has no claim to', () => withEnv(async () => {
    const seen = { rpcCalled: false };
    globalThis.fetch = heartbeatFetch(seen);
    const token = userToken({ brand_id: BRAND, location_ids: [] });
    const response = await POST(heartbeat({ installationId: INSTALLATION, locationId: ELSEWHERE }, token));
    assert.equal(response.status, 403);
    assert.equal(seen.rpcCalled, false, 'the heartbeat RPC ran for a caller with no location claim');
  }));

  it('refuses a location-scoped staff caller naming another store', () => withEnv(async () => {
    const seen = { rpcCalled: false };
    globalThis.fetch = heartbeatFetch(seen);
    const token = userToken({ brand_id: BRAND, location_ids: [HERE], role: 'location_manager' });
    const response = await POST(heartbeat({ installationId: INSTALLATION, locationId: ELSEWHERE }, token));
    assert.equal(response.status, 403);
    assert.equal(seen.rpcCalled, false, 'the heartbeat RPC ran for a location outside the caller\'s claims');
  }));

  it('accepts a staff caller ringing in for their own location', () => withEnv(async () => {
    const seen = { rpcCalled: false };
    globalThis.fetch = heartbeatFetch(seen);
    const token = userToken({ brand_id: BRAND, location_ids: [HERE], role: 'location_manager' });
    const response = await POST(heartbeat({ installationId: INSTALLATION, locationId: HERE }, token));
    assert.equal(response.status, 200);
    assert.equal(seen.rpcCalled, true);
  }));

  it('lets a brand owner heartbeat any of the brand\'s locations', () => withEnv(async () => {
    const seen = { rpcCalled: false };
    globalThis.fetch = heartbeatFetch(seen);
    const token = userToken({ brand_id: BRAND, location_ids: [], role: 'brand_owner' });
    const response = await POST(heartbeat({ installationId: INSTALLATION, locationId: ELSEWHERE }, token));
    assert.equal(response.status, 200);
    assert.equal(seen.rpcCalled, true);
  }));
});
