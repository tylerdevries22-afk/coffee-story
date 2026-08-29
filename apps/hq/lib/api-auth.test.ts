import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { SupabaseClient } from '@supabase/supabase-js';
import { signDeviceToken, type DeviceClaims, type DeviceRowLike } from '@platform/engine';

import {
  CORS_HEADERS, authenticate, authenticateAny, authenticatedDb, corsPreflight,
  idempotencyKeyOf, jsonError, jsonWithCors, matchesSecret, notConfigured, parseJsonBody,
  resolveCustomer, serverEnv,
  type AuthedRequest,
} from './api-auth';

const BRAND = '11111111-1111-4111-8111-111111111111';
const LOCATION = '22222222-2222-4222-8222-222222222222';
const DEVICE = '33333333-3333-4333-8333-333333333333';
const USER = '44444444-4444-4444-8444-444444444444';
const SECRET = 'k'.repeat(48);
const NOW = 1_760_000_000_000;

/**
 * Env is read per request, so every case that depends on it has to set it and
 * put it back. Deleting the keys rather than reassigning them matters: the
 * device path branches on absence, not on emptiness.
 */
function withEnv<T>(vars: Record<string, string | undefined>, run: () => T): T {
  const saved = { ...process.env };
  for (const [key, value] of Object.entries(vars)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return run();
  } finally {
    for (const key of Object.keys(process.env)) delete process.env[key];
    Object.assign(process.env, saved);
  }
}

const bearer = (token: string) =>
  new Request('https://api.test/x', { headers: { authorization: `Bearer ${token}` } });

/** A base64url JWT body with no signature: `authenticate` never checks one. */
const userToken = (metadata: unknown) =>
  `header.${Buffer.from(JSON.stringify({ app_metadata: metadata })).toString('base64url')}.sig`;

type GetUser = { data: { user: unknown }; error: unknown };

/**
 * `calls` counts getUser, because the empty-token guards are invisible in the
 * status they produce -- a request with no token and a request with a junk
 * token are both 401. What separates them is whether GoTrue was asked at all.
 */
const asked = { calls: 0 };

const userDb = (answer: GetUser): SupabaseClient => {
  asked.calls = 0;
  return {
    auth: {
      getUser: async () => {
        asked.calls += 1;
        return answer;
      },
    },
  } as unknown as SupabaseClient;
};

const good: GetUser = { data: { user: { id: USER, email: 'barista@example.test' } }, error: null };

const CLAIMS: DeviceClaims = {
  brandId: BRAND, deviceId: DEVICE, locationId: LOCATION, role: 'kiosk', tokenVersion: 3,
};

const deviceRow = (over: Partial<DeviceRowLike> = {}): DeviceRowLike => ({
  id: DEVICE,
  brand_id: BRAND,
  location_id: LOCATION,
  role: 'kiosk',
  label: 'Front kiosk',
  pairing_code_hash: null,
  pairing_expires_at: null,
  paired_at: new Date(NOW - 86_400_000).toISOString(),
  revoked_at: null,
  last_seen_at: null,
  token_version: 3,
  ...over,
});

/** Answers the device re-read, and the user path if the test falls through. */
const mixedDb = (row: DeviceRowLike | null, user: GetUser = good): SupabaseClient => {
  asked.calls = 0;
  const query = { select: () => query, eq: () => query, maybeSingle: async () => ({ data: row, error: null }) };
  return {
    from: () => query,
    auth: {
      getUser: async () => {
        asked.calls += 1;
        return user;
      },
    },
  } as unknown as SupabaseClient;
};

const status = (result: unknown): number => {
  assert.ok(result instanceof Response, 'expected a refusal, got a caller');
  return result.status;
};

const codeOf = async (result: unknown): Promise<string> => {
  assert.ok(result instanceof Response);
  return ((await result.json()) as { error: { code: string } }).error.code;
};

const messageOf = async (result: unknown): Promise<string> => {
  assert.ok(result instanceof Response);
  return ((await result.json()) as { error: { message: string } }).error.message;
};

describe('serverEnv', () => {
  it('needs both halves, because one alone builds a client that cannot authenticate', () => {
    const both = { SUPABASE_URL: 'https://p.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'service' };
    assert.deepEqual(withEnv(both, serverEnv), { url: 'https://p.supabase.co', serviceRoleKey: 'service' });
    assert.equal(withEnv({ ...both, SUPABASE_URL: undefined }, serverEnv), null);
    assert.equal(withEnv({ ...both, SUPABASE_SERVICE_ROLE_KEY: undefined }, serverEnv), null);
  });

  it('treats an empty string as unset, not as configured', () => {
    assert.equal(withEnv({ SUPABASE_URL: '', SUPABASE_SERVICE_ROLE_KEY: 'service' }, serverEnv), null);
  });
});

describe('matchesSecret', () => {
  const expected = 'the-cron-secret';

  it('accepts the exact secret and nothing else', () => {
    assert.equal(matchesSecret(expected, expected), true);
    assert.equal(matchesSecret('the-cron-secreT', expected), false);
  });

  /**
   * Length is checked first because timingSafeEqual throws on a mismatch. The
   * throw would be a 500 where a 401 belongs, so a wrong-length secret has to
   * return false rather than escape.
   */
  it('refuses a shorter and a longer secret without throwing', () => {
    assert.equal(matchesSecret('the-cron-secre', expected), false);
    assert.equal(matchesSecret(`${expected}x`, expected), false);
    assert.equal(matchesSecret('', expected), false);
    assert.equal(matchesSecret(null, expected), false);
  });
});

describe('idempotencyKeyOf', () => {
  const withKey = (key?: string) =>
    idempotencyKeyOf(new Request('https://api.test/x', { headers: key ? { 'idempotency-key': key } : {} }));

  it('is null when the client sent none, which is not an error', () => {
    assert.equal(withKey(), null);
  });

  /**
   * Three outcomes, not two. orders.client_key is a uuid column, so a
   * malformed key reaching Postgres came back as 22P02 and surfaced as a 500 --
   * the client's bad header reported as the server's fault. `false` is what
   * lets the route answer 400 instead.
   */
  it('separates absent from unusable', () => {
    assert.equal(withKey('not-a-uuid'), false);
    assert.equal(withKey(''), null, 'an empty header is no header');
    assert.equal(withKey(`${BRAND}${BRAND}`), false, 'a uuid with more after it is not a uuid');
  });

  /**
   * Headers normalise their own surrounding whitespace before a handler sees
   * them, so the anchored regex is not what handles a padded value and should
   * not be credited with it. Written down because it looks like a gap.
   */
  it('is handed an already-trimmed header value by the platform', () => {
    assert.equal(withKey(` ${BRAND} `), BRAND);
    assert.equal(withKey(BRAND.replace('-', ' ')), false, 'interior space is still not a uuid');
  });

  it('lower-cases, so the same key in two cases is one key', () => {
    assert.equal(withKey(BRAND.toUpperCase()), BRAND);
  });
});

describe('authenticate', () => {
  it('reads the claims the auth hook minted into the token, not the stored user', async () => {
    const result = await authenticate(
      bearer(userToken({ brand_id: BRAND, location_ids: [LOCATION], role: 'staff' })),
      userDb(good),
    );
    assert.deepEqual(result, {
      userId: USER,
      email: 'barista@example.test',
      claims: { brand_id: BRAND, location_ids: [LOCATION], role: 'staff' },
    });
  });

  it('refuses a request with no bearer token without asking GoTrue', async () => {
    const db = userDb(good);
    assert.equal(status(await authenticate(new Request('https://api.test/x'), db)), 401);
    assert.equal(asked.calls, 0, 'an empty token was sent for verification');

    const scheme = userDb(good);
    const wrongScheme = await authenticate(
      new Request('https://api.test/x', { headers: { authorization: `Basic ${userToken({})}` } }),
      scheme,
    );
    assert.equal(status(wrongScheme), 401);
    assert.equal(asked.calls, 0);
  });

  /**
   * Both halves matter separately. An error alongside a user object is the
   * shape that would slip through if these were ever read as one condition:
   * the error says the token is not good, and the stale user says who it would
   * have been, and accepting on the second is accepting a token GoTrue just
   * refused.
   */
  it('refuses on the error even when a user object came back with it', async () => {
    const withStaleUser = await authenticate(bearer(userToken({ brand_id: BRAND })), userDb({
      data: { user: { id: USER, email: 'stale@example.test' } },
      error: { message: 'token has expired' },
    }));
    assert.equal(status(withStaleUser), 401);

    const withoutUser = await authenticate(bearer(userToken({ brand_id: BRAND })), userDb({
      data: { user: null }, error: null,
    }));
    assert.equal(status(withoutUser), 401);
  });

  it('refuses a token GoTrue will not vouch for', async () => {
    const rejected = await authenticate(bearer(userToken({ brand_id: BRAND })), userDb({
      data: { user: null }, error: { message: 'expired' },
    }));
    assert.equal(status(rejected), 401);
  });

  /**
   * A verified user is not the same as a verified tenant, and the difference
   * is the status. 401 tells a client to sign in again, which for someone
   * already signed in is a loop; 403 tells them the account is real and
   * belongs to no brand.
   */
  it('separates a bad token from a good token carrying no tenancy', async () => {
    assert.equal(await codeOf(await authenticate(bearer(userToken({})), userDb(good))), 'no_tenant');
    assert.equal(status(await authenticate(bearer(userToken({})), userDb(good))), 403);
    assert.equal(status(await authenticate(bearer(userToken({ brand_id: 'nope' })), userDb(good))), 403);
  });

  it('answers a token whose body is not JSON, rather than throwing on it', async () => {
    assert.equal(status(await authenticate(bearer('a.@@@@.c'), userDb(good))), 401);
    assert.equal(status(await authenticate(bearer('onlyonesegment'), userDb(good))), 401);
  });

  it('carries a null email through rather than inventing one', async () => {
    const result = await authenticate(bearer(userToken({ brand_id: BRAND })), userDb({
      data: { user: { id: USER, email: undefined } }, error: null,
    }));
    assert.deepEqual(result, { userId: USER, email: null, claims: { brand_id: BRAND, location_ids: [] } });
  });
});

describe('authenticateAny', () => {
  const KEY = { secret: SECRET, issuer: 'device-pairing' };
  const deviceToken = () => signDeviceToken(CLAIMS, KEY, Date.now());
  const configured = { SUPABASE_JWT_SECRET: SECRET, SUPABASE_URL: undefined };

  it('recognises a paired device and returns the row, not just the token', async () => {
    const row = deviceRow();
    const result = await withEnv(configured, () => authenticateAny(bearer(deviceToken()), mixedDb(row)));
    assert.deepEqual(result, { kind: 'device', device: row, claims: CLAIMS });
  });

  /**
   * The token stays cryptographically valid for the rest of its twelve hours,
   * so the re-read is the only thing that stops a revoked kiosk ringing sales.
   */
  it('refuses a device whose row has moved on since the token was minted', async () => {
    for (const over of [
      { revoked_at: new Date(NOW).toISOString() },
      { paired_at: null },
      { token_version: 4 },
      { brand_id: LOCATION },
    ]) {
      const result = await withEnv(configured, () =>
        authenticateAny(bearer(deviceToken()), mixedDb(deviceRow(over))));
      assert.equal(status(result), 401, JSON.stringify(over));
    }
    const gone = await withEnv(configured, () => authenticateAny(bearer(deviceToken()), mixedDb(null)));
    assert.equal(status(gone), 401);
  });

  /**
   * A GoTrue staff token is HS256 under the same project secret, so a
   * signature check alone cannot tell the two issuers apart. What separates
   * them is that a device token carries a device_id and no `sub`. If that ever
   * stopped holding, a staff token would be accepted as whatever device its
   * metadata named -- so this asserts the user path is what handles it.
   */
  it('does not mistake a staff token for a device, though both are HS256 here', async () => {
    const staff = userToken({ brand_id: BRAND, location_ids: [LOCATION], role: 'staff' });
    const result = await withEnv(configured, () => authenticateAny(bearer(staff), mixedDb(null)));
    assert.deepEqual(result, {
      kind: 'user',
      userId: USER,
      email: 'barista@example.test',
      claims: { brand_id: BRAND, location_ids: [LOCATION], role: 'staff' },
    });
  });

  /**
   * A deployment with no device pairing configured must still serve users.
   * Failing the request here would take out six routes that never wanted a
   * device in the first place.
   */
  it('falls through to the user path when device pairing is unconfigured', async () => {
    const result = await withEnv({ SUPABASE_JWT_SECRET: undefined }, () =>
      authenticateAny(bearer(userToken({ brand_id: BRAND })), mixedDb(null)));
    assert.deepEqual(result, { kind: 'user', userId: USER, email: 'barista@example.test', claims: { brand_id: BRAND, location_ids: [] } });
  });

  /**
   * Both header guards here are redundant with the identical pair inside
   * `authenticate`, which re-reads the header rather than being handed the
   * parsed token -- so deleting either one still ends in a 401 and asserting
   * the status proves nothing. The wording is the part that is not redundant.
   * This route is the one callers reach with a DEVICE token, and telling a
   * kiosk to send a Supabase access token names a credential it has no way to
   * obtain. Asserting the message is what pins the refusal to this layer.
   */
  const DEVICE_AWARE = 'Send an access token as a Bearer token.';

  it('refuses an empty bearer before consulting anything, in its own words', async () => {
    const db = mixedDb(null);
    const result = await withEnv(configured, () => authenticateAny(new Request('https://api.test/x'), db));
    assert.equal(status(result), 401);
    assert.equal(await messageOf(result), DEVICE_AWARE);
    assert.equal(asked.calls, 0, 'a tokenless request was sent for verification');
  });

  it('refuses an authorization header that is not a Bearer scheme', async () => {
    const db = mixedDb(null);
    const result = await withEnv(configured, () => authenticateAny(
      new Request('https://api.test/x', { headers: { authorization: `Basic ${userToken({ brand_id: BRAND })}` } }),
      db,
    ));
    assert.equal(status(result), 401);
    // Without the scheme check the slice yields a truncated but non-empty
    // string, which passes the emptiness guard and is refused two layers down.
    assert.equal(await messageOf(result), DEVICE_AWARE);
    assert.equal(asked.calls, 0);
  });

  /**
   * The user path's refusal is a Response, and it has to be returned as one.
   * Spread into a caller instead it becomes `{ kind: 'user' }` with no claims
   * and no userId -- an object every downstream route would treat as an
   * authenticated caller, from a request that was just refused.
   */
  it('returns the user path refusal rather than wrapping it as a caller', async () => {
    const result = await withEnv(configured, () => authenticateAny(
      bearer(userToken({ brand_id: BRAND })),
      mixedDb(null, { data: { user: null }, error: { message: 'expired' } }),
    ));
    assert.ok(result instanceof Response, 'a refused request came back as a caller');
    assert.equal(result.status, 401);

    const noTenant = await withEnv(configured, () => authenticateAny(bearer(userToken({})), mixedDb(null)));
    assert.ok(noTenant instanceof Response);
    assert.equal(noTenant.status, 403);
  });
});

describe('authenticatedDb', () => {
  /**
   * Null is the refusal. A client built without the caller's token would carry
   * only the service-role key, and every RLS check downstream would pass.
   */
  it('refuses to build a client for a request carrying no bearer token', () => {
    const env = { url: 'https://p.supabase.co', serviceRoleKey: 'service' };
    assert.equal(authenticatedDb(env, new Request('https://api.test/x')), null);
    assert.equal(
      authenticatedDb(env, new Request('https://api.test/x', { headers: { authorization: 'Basic abc' } })),
      null,
    );
    assert.notEqual(authenticatedDb(env, bearer('token')), null);
  });
});

describe('the shared response shape', () => {
  it('answers preflight with no content and the full header set', async () => {
    const preflight = corsPreflight();
    assert.equal(preflight.status, 204);
    for (const [header, value] of Object.entries(CORS_HEADERS)) {
      assert.equal(preflight.headers.get(header), value, header);
    }
  });

  /** The client reads error.code; a bare message would leave it guessing. */
  it('puts every error in one envelope, with CORS still attached', async () => {
    const error = jsonError(418, 'teapot', 'No coffee here.');
    assert.equal(error.status, 418);
    assert.equal(error.headers.get('Access-Control-Allow-Origin'), '*');
    assert.deepEqual(await error.json(), { error: { code: 'teapot', message: 'No coffee here.' } });
  });

  it('defaults a success to 200, not to a status with different cache semantics', async () => {
    const ok = jsonWithCors({ fine: true });
    assert.equal(ok.status, 200);
    assert.equal(jsonWithCors({ made: true }, 201).status, 201);
  });

  /**
   * 501 says this deployment was never given its Supabase configuration, which
   * is a deploy step nobody ran. A 5xx from the 502 family says a healthy
   * request failed upstream and invites a retry that cannot ever succeed.
   */
  it('answers an unconfigured deployment 501, which is not a transient failure', async () => {
    const response = notConfigured();
    assert.equal(response.status, 501);
    assert.equal(await codeOf(response), 'not_configured');
  });

  it('allows the idempotency-key header, or the browser strips it before it arrives', () => {
    assert.match(CORS_HEADERS['Access-Control-Allow-Headers'], /idempotency-key/);
  });

  it('answers a junk body with 400 rather than throwing', async () => {
    const request = new Request('https://api.test/x', { method: 'POST', body: 'not json' });
    assert.equal(status(await parseJsonBody(request)), 400);
    const ok = new Request('https://api.test/x', { method: 'POST', body: '{"a":1}' });
    assert.deepEqual(await parseJsonBody(ok), { a: 1 });
  });
});

describe('resolveCustomer', () => {
  const auth: AuthedRequest = {
    userId: USER, email: 'guest@example.test', claims: { brand_id: BRAND, location_ids: [] },
  };
  const identity = { id: 'c1', full_name: '', email: 'guest@example.test', phone: null, sms_opt_in: false };

  /** Reads and inserts answer in order, so a race can be staged as a script. */
  const customerDb = (steps: { data: unknown; error: unknown }[]): SupabaseClient => {
    const query = {
      select: () => query,
      eq: () => query,
      insert: () => query,
      maybeSingle: async () => steps.shift() ?? { data: null, error: null },
      single: async () => steps.shift() ?? { data: null, error: null },
    };
    return { from: () => query } as unknown as SupabaseClient;
  };

  it('returns the existing row without inserting', async () => {
    assert.deepEqual(await resolveCustomer(customerDb([{ data: identity, error: null }]), auth), identity);
  });

  it('creates the row on first contact, so a first order needs no profile step', async () => {
    const db = customerDb([{ data: null, error: null }, { data: identity, error: null }]);
    assert.deepEqual(await resolveCustomer(db, auth), identity);
  });

  /**
   * Two first-contact requests race and UNIQUE (brand_id, user_id) keeps one.
   * The loser must re-read and return the winner's row: throwing here would
   * fail a request whose customer demonstrably exists.
   */
  it('re-reads the winner rather than failing the loser of a race', async () => {
    const db = customerDb([
      { data: null, error: null },
      { data: null, error: { code: '23505', message: 'duplicate key' } },
      { data: identity, error: null },
    ]);
    assert.deepEqual(await resolveCustomer(db, auth), identity);
  });

  /**
   * The re-read is a recovery, not a guarantee. If it fails too there is no
   * customer to return, and returning its empty data would hand the caller an
   * identity with no id -- so the original insert error has to surface.
   */
  it('throws when the race re-read fails as well, rather than returning nothing', async () => {
    const db = customerDb([
      { data: null, error: null },
      { data: null, error: { code: '23505', message: 'duplicate key' } },
      { data: null, error: { code: '08006', message: 'connection failure' } },
    ]);
    await assert.rejects(
      () => resolveCustomer(db, auth),
      (error: { code?: string }) => error.code === '23505',
    );
  });

  /** Any other insert failure is a real failure and must not be swallowed. */
  it('rethrows an insert error that is not the race', async () => {
    const db = customerDb([
      { data: null, error: null },
      { data: null, error: { code: '23503', message: 'brand does not exist' } },
    ]);
    await assert.rejects(
      () => resolveCustomer(db, auth),
      (error: { code?: string }) => error.code === '23503',
    );
  });

  it('rethrows a failed read rather than treating it as absent and inserting', async () => {
    const db = customerDb([{ data: null, error: { code: '08006', message: 'connection failure' } }]);
    await assert.rejects(
      () => resolveCustomer(db, auth),
      (error: { code?: string }) => error.code === '08006',
    );
  });
});
