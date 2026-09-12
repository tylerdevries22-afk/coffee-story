import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { POST as mintPairingCode } from '../app/api/devices/route';
import { POST as refreshSecret } from '../app/api/devices/refresh-secret/route';
import { POST as revokeDevice } from '../app/api/devices/revoke/route';
import { DELETE as revokeInstallation } from '../app/api/device-wall/installations/[id]/route';
import { resetRateLimits } from './rate-limit';

const BRAND = '11111111-1111-4111-8111-111111111111';
const INSTALLATION = '55555555-5555-4555-8555-555555555555';
const BUDGET = 20;

const ENV = {
  SUPABASE_URL: 'https://database.example.test',
  SUPABASE_SERVICE_ROLE_KEY: 'test-service-key',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'test-anon-key',
};

/** A base64url JWT body with no signature: `authenticate` never checks one --
 *  verification happens against the mocked GoTrue endpoint below. */
const userToken = (metadata: unknown) =>
  `header.${Buffer.from(JSON.stringify({ app_metadata: metadata })).toString('base64url')}.sig`;

/**
 * A guest -- a brand but no staff role -- so every one of these calls is
 * refused by the shared device-admin authorization (or the installations
 * route's own role check) immediately after the rate check, without ever
 * touching a devices/locations table. That keeps this fixture to the one
 * endpoint every one of these routes actually needs: GoTrue's own `/user`,
 * to resolve the caller identity the limiter keys on. The id it hands back is
 * derived from the caller's own bearer token, so two different tokens resolve
 * as two different identities -- needed for the last test below.
 */
function authFetch(): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(String(input)).pathname;
    if (path.endsWith('/auth/v1/user')) {
      const bearer = new Headers(init?.headers).get('authorization') ?? '';
      return Response.json({ id: `user:${bearer}`, email: 'staff@example.test' });
    }
    throw new Error(`Unexpected request path ${path}`);
  }) as typeof fetch;
}

async function withEnv(run: () => Promise<void>): Promise<void> {
  const previous = Object.fromEntries(Object.keys(ENV).map((key) => [key, process.env[key]]));
  Object.assign(process.env, ENV);
  resetRateLimits();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = authFetch();
  try {
    await run();
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
}

function bearerRequest(url: string, token: string, init: RequestInit = {}): Request {
  return new Request(url, {
    method: 'POST',
    ...init,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...init.headers },
  });
}

const GUEST = userToken({ brand_id: BRAND, location_ids: [] });

/** Spends the identity's whole budget and returns the response to the next
 *  (over-budget) request, so every route's test asserts the same shape. */
async function spendBudgetThenOne(
  send: () => Promise<Response>,
): Promise<Response> {
  for (let attempt = 0; attempt < BUDGET; attempt += 1) {
    const response = await send();
    assert.notEqual(response.status, 429, `attempt ${attempt + 1} of ${BUDGET} was throttled early`);
  }
  return send();
}

describe('per-identity rate limits on device-admin writes', () => {
  /**
   * Before this fix, none of these four routes called `rateLimited` at all --
   * a stolen staff bearer token could mint pairing codes, rotate secrets,
   * revoke devices, or revoke installations at whatever rate the caller could
   * send requests. Every case below fails against that code because the
   * (BUDGET + 1)th request never comes back 429.
   */
  it('throttles POST /api/devices after the shared identity budget is spent', () => withEnv(async () => {
    const blocked = await spendBudgetThenOne(
      () => mintPairingCode(bearerRequest('https://hq.example.test/api/devices', GUEST, { body: '{}' })),
    );
    assert.equal(blocked.status, 429);
  }));

  it('throttles POST /api/devices/refresh-secret after the shared identity budget is spent', () => withEnv(async () => {
    const blocked = await spendBudgetThenOne(
      () => refreshSecret(bearerRequest('https://hq.example.test/api/devices/refresh-secret', GUEST, { body: '{}' })),
    );
    assert.equal(blocked.status, 429);
  }));

  it('throttles POST /api/devices/revoke after the shared identity budget is spent', () => withEnv(async () => {
    const blocked = await spendBudgetThenOne(
      () => revokeDevice(bearerRequest('https://hq.example.test/api/devices/revoke', GUEST, { body: '{}' })),
    );
    assert.equal(blocked.status, 429);
  }));

  it('throttles DELETE /api/device-wall/installations/[id] after the shared identity budget is spent', () => withEnv(async () => {
    const params = Promise.resolve({ id: INSTALLATION });
    const send = () => revokeInstallation(
      new Request(`https://hq.example.test/api/device-wall/installations/${INSTALLATION}`, {
        method: 'DELETE',
        headers: { authorization: `Bearer ${GUEST}` },
      }),
      { params },
    );
    const blocked = await spendBudgetThenOne(send);
    assert.equal(blocked.status, 429);
  }));

  /**
   * Different callers must never share a budget: keying on IP (or nothing at
   * all) would let one legitimate staff member's normal traffic lock out
   * every other manager at the brand. The mocked GoTrue endpoint above ties
   * the resolved user id to the exact bearer token sent, so this second token
   * is guaranteed to land in a different bucket if -- and only if -- the
   * route keys on caller identity as it should.
   */
  it('does not let one caller\'s spent budget block a different caller', () => withEnv(async () => {
    const blocked = await spendBudgetThenOne(
      () => mintPairingCode(bearerRequest('https://hq.example.test/api/devices', GUEST, { body: '{}' })),
    );
    assert.equal(blocked.status, 429);

    const otherCaller = userToken({ brand_id: BRAND, location_ids: [], role: undefined, note: 'second-caller' });
    const stillAllowed = await mintPairingCode(
      bearerRequest('https://hq.example.test/api/devices', otherCaller, { body: '{}' }),
    );
    assert.notEqual(stillAllowed.status, 429);
  }));
});
