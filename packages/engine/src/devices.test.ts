import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { describe, it } from 'node:test';

import type { SupabaseClient } from '@supabase/supabase-js';

import {
  DEVICE_TOKEN_TTL_SECONDS, DeviceError, PAIRING_TTL_MINUTES, REFRESH_SECRET_OVERLAP_MINUTES,
  canPlaceOrders, exchangeDeviceRefreshSecret, hashPairingCode, hashRefreshSecret,
  issueDeviceRefreshSecret, issuePairingCode, loadActiveDevice, loadDeviceSigningKey,
  newPairingCode, newRefreshSecret, normalizeCode, redeemPairingCode,
  refreshDeviceToken, revokeDevice, signDeviceToken,
  tenantSlugMatches, verifyDeviceToken, type DeviceClaims, type DeviceRowLike, type DeviceSigningKey,
} from './devices';

const KEY: DeviceSigningKey = { secret: 'a'.repeat(48), issuer: 'https://example.test/auth/v1' };
const OTHER: DeviceSigningKey = { secret: 'b'.repeat(48), issuer: 'https://example.test/auth/v1' };
const NOW = 1_800_000_000_000;

const CLAIMS: DeviceClaims = {
  brandId: '11111111-1111-4111-8111-111111111111',
  deviceId: '22222222-2222-4222-8222-222222222222',
  locationId: '33333333-3333-4333-8333-333333333333',
  role: 'kiosk',
  tokenVersion: 3,
};

const decode = (token: string) =>
  JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8')) as Record<string, unknown>;

const resign = (payload: object, key = KEY, header: object = { alg: 'HS256', typ: 'JWT' }) => {
  const b = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const head = b(header);
  const body = b(payload);
  return `${head}.${body}.${createHmac('sha256', key.secret).update(`${head}.${body}`).digest('base64url')}`;
};

describe('newPairingCode', () => {
  it('avoids every character a barista could misread or mis-say', () => {
    // No I/O/0/1 (misread off a screen) and no vowels (so it cannot spell a
    // word someone has to read out to a customer).
    for (let attempt = 0; attempt < 200; attempt += 1) {
      assert.match(newPairingCode(), /^[23456789BCDFGHJKMNPQRSTVWXZ]{8}$/);
    }
  });

  it('does not repeat itself across a realistic number of pairings', () => {
    const seen = new Set(Array.from({ length: 500 }, () => newPairingCode()));
    assert.ok(seen.size > 495, `only ${seen.size} distinct codes in 500 draws`);
  });
});

describe('hashPairingCode', () => {
  /**
   * `devices_select` is brand-wide and includes role 'staff', so a plaintext
   * column let any barista read any location's code and pair their own tablet.
   */
  it('is stable for a code and different for a different secret', () => {
    assert.equal(hashPairingCode('ABC23456', KEY), hashPairingCode('ABC23456', KEY));
    assert.notEqual(hashPairingCode('ABC23456', KEY), hashPairingCode('ABC23456', OTHER));
  });

  it('ignores how the code was typed, not what it is', () => {
    assert.equal(hashPairingCode('bc23-4567', KEY), hashPairingCode('BC234567', KEY));
    assert.notEqual(hashPairingCode('BC234567', KEY), hashPairingCode('BC234568', KEY));
    assert.equal(normalizeCode(' bc23 4567 '), 'BC234567');
  });
});

describe('tenantSlugMatches', () => {
  it('refuses a valid code belonging to another white-label tenant', () => {
    assert.equal(tenantSlugMatches('coffee-story', 'coffee-story'), true);
    assert.equal(tenantSlugMatches('other-roastery', 'coffee-story'), false);
    assert.equal(tenantSlugMatches('coffee-story', '../coffee-story'), false);
  });
});

type PairingDbState = {
  row: DeviceRowLike;
  initialReads: number;
  releaseReads: (() => void) | null;
  readsReady: Promise<void>;
};

class PairingQuery {
  private mode: 'read' | 'update' = 'read';
  private readonly equals = new Map<string, unknown>();
  private readonly nulls = new Set<string>();
  private readonly greaterThan = new Map<string, unknown>();
  private updateValues: Record<string, unknown> = {};

  constructor(private readonly state: PairingDbState, private readonly table: string) {}
  select(): this { return this; }
  update(values: Record<string, unknown>): this { this.mode = 'update'; this.updateValues = values; return this; }
  eq(column: string, value: unknown): this { this.equals.set(column, value); return this; }
  is(column: string): this { this.nulls.add(column); return this; }
  gt(column: string, value: unknown): this { this.greaterThan.set(column, value); return this; }

  async maybeSingle(): Promise<{ data: unknown; error: null }> {
    if (this.table === 'brands') return { data: { slug: 'coffee-story' }, error: null };
    if (this.mode === 'update') return { data: this.applyUpdate(), error: null };
    const snapshot = { ...this.state.row };
    if (this.equals.get('pairing_code_hash') !== snapshot.pairing_code_hash) {
      return { data: null, error: null };
    }
    this.state.initialReads += 1;
    if (this.state.initialReads === 2) this.state.releaseReads?.();
    await this.state.readsReady;
    return { data: snapshot, error: null };
  }

  private applyUpdate(): DeviceRowLike | null {
    const row = this.state.row as DeviceRowLike & Record<string, unknown>;
    for (const [column, value] of this.equals) if (row[column] !== value) return null;
    for (const column of this.nulls) if (row[column] !== null) return null;
    for (const [column, value] of this.greaterThan) {
      if (typeof row[column] !== 'string' || typeof value !== 'string' || row[column] <= value) return null;
    }
    Object.assign(row, this.updateValues);
    return { ...this.state.row };
  }
}

function concurrentPairingDb(codeHash: string): SupabaseClient {
  let releaseReads: (() => void) | null = null;
  const readsReady = new Promise<void>((resolve) => { releaseReads = resolve; });
  const state: PairingDbState = {
    row: {
      id: CLAIMS.deviceId,
      brand_id: CLAIMS.brandId,
      location_id: CLAIMS.locationId,
      role: CLAIMS.role,
      label: 'Lobby kiosk',
      pairing_code_hash: codeHash,
      pairing_expires_at: new Date(NOW + 60_000).toISOString(),
      paired_at: null,
      revoked_at: null,
      last_seen_at: null,
      token_version: 1,
    },
    initialReads: 0,
    releaseReads,
    readsReady,
  };
  return { from: (table: string) => new PairingQuery(state, table) } as unknown as SupabaseClient;
}

describe('redeemPairingCode', () => {
  it('atomically lets only one concurrent request consume a code', async () => {
    const code = 'BC234567';
    const db = concurrentPairingDb(hashPairingCode(code, KEY));
    const attempts = await Promise.allSettled([
      redeemPairingCode({ db, key: KEY, now: () => NOW }, { code, expectedBrandSlug: 'coffee-story' }),
      redeemPairingCode({ db, key: KEY, now: () => NOW }, { code, expectedBrandSlug: 'coffee-story' }),
    ]);
    assert.equal(attempts.filter((attempt) => attempt.status === 'fulfilled').length, 1);
    const rejection = attempts.find((attempt) => attempt.status === 'rejected');
    assert.ok(rejection?.status === 'rejected' && rejection.reason instanceof DeviceError);
    if (rejection?.status === 'rejected' && rejection.reason instanceof DeviceError) {
      assert.equal(rejection.reason.code, 'pairing_unknown');
    }
  });
});

describe('refreshDeviceToken', () => {
  const activeDevice: DeviceRowLike = {
    id: CLAIMS.deviceId,
    brand_id: CLAIMS.brandId,
    location_id: CLAIMS.locationId,
    role: CLAIMS.role,
    label: 'Lobby kiosk',
    pairing_code_hash: null,
    pairing_expires_at: null,
    paired_at: new Date(NOW - 60_000).toISOString(),
    revoked_at: null,
    last_seen_at: null,
    token_version: CLAIMS.tokenVersion,
  };

  const refreshDb = (heartbeatError: { message: string } | null): SupabaseClient => ({
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: activeDevice, error: null }) }),
      }),
      update: () => ({ eq: async () => ({ error: heartbeatError }) }),
    }),
  }) as unknown as SupabaseClient;

  it('persists its heartbeat before returning a replacement credential', async () => {
    const refreshed = await refreshDeviceToken({ db: refreshDb(null), key: KEY, now: () => NOW }, CLAIMS);
    assert.deepEqual(verifyDeviceToken(refreshed.token, KEY, NOW), CLAIMS);
  });

  it('fails closed when the heartbeat cannot be persisted', async () => {
    await assert.rejects(
      refreshDeviceToken({ db: refreshDb({ message: 'write failed' }), key: KEY, now: () => NOW }, CLAIMS),
      (error: unknown) => error instanceof DeviceError && error.code === 'invalid_request',
    );
  });
});

describe('signDeviceToken', () => {
  it('round-trips the claims exactly', () => {
    const token = signDeviceToken(CLAIMS, KEY, NOW);
    assert.deepEqual(verifyDeviceToken(token, KEY, NOW), CLAIMS);
  });

  /**
   * The security argument, made executable. An exact key-set assertion means a
   * future edit cannot quietly smuggle a `role` or a `sub` into the payload.
   */
  it('carries no sub and no staff role, and nothing else in app_metadata', () => {
    const payload = decode(signDeviceToken(CLAIMS, KEY, NOW));
    assert.equal(payload.sub, undefined, 'a sub would make auth.uid() non-null');
    assert.equal(payload.role, 'authenticated', 'the Postgres role PostgREST assumes');
    assert.deepEqual(
      Object.keys(payload.app_metadata as object).sort(),
      ['brand_id', 'device_id', 'device_location_id', 'device_role', 'device_token_version'],
    );
    assert.equal((payload.app_metadata as Record<string, unknown>).role, undefined);
  });

  it('expires within the shift', () => {
    const payload = decode(signDeviceToken(CLAIMS, KEY, NOW));
    assert.equal((payload.exp as number) - (payload.iat as number), DEVICE_TOKEN_TTL_SECONDS);
  });
});

describe('verifyDeviceToken rejects', () => {
  it('a token signed with any other secret', () => {
    assert.equal(verifyDeviceToken(signDeviceToken(CLAIMS, OTHER, NOW), KEY, NOW), null);
  });

  it('an expired token', () => {
    const token = signDeviceToken(CLAIMS, KEY, NOW, 60);
    assert.deepEqual(verifyDeviceToken(token, KEY, NOW), CLAIMS);
    assert.equal(verifyDeviceToken(token, KEY, NOW + 61_000), null);
  });

  it('a tampered payload', () => {
    const token = signDeviceToken(CLAIMS, KEY, NOW);
    const [head, , sig] = token.split('.');
    const forged = Buffer.from(JSON.stringify({ app_metadata: { device_role: 'pos' } })).toString('base64url');
    assert.equal(verifyDeviceToken(`${head}.${forged}.${sig}`, KEY, NOW), null);
  });

  it('alg none', () => {
    const b = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
    assert.equal(verifyDeviceToken(`${b({ alg: 'none', typ: 'JWT' })}.${b({})}.`, KEY, NOW), null);
  });

  /**
   * A GoTrue staff token is also HS256 with the same project secret, so a
   * signature check alone does not tell the two issuers apart. GoTrue always
   * sets `sub`; a device token never does.
   */
  it('a staff token that happens to share the secret', () => {
    const staffish = resign({
      sub: '44444444-4444-4444-8444-444444444444',
      role: 'authenticated', aud: 'authenticated',
      exp: Math.floor(NOW / 1000) + 3600,
      app_metadata: {
        brand_id: CLAIMS.brandId, device_id: CLAIMS.deviceId,
        device_role: 'kiosk', device_location_id: CLAIMS.locationId, device_token_version: 1,
      },
    });
    assert.equal(verifyDeviceToken(staffish, KEY, NOW), null, 'a token with a sub must never verify as a device');
  });

  it('a token claiming a staff role, rather than ignoring the claim', () => {
    const escalated = resign({
      role: 'authenticated', aud: 'authenticated', exp: Math.floor(NOW / 1000) + 3600,
      app_metadata: {
        role: 'brand_owner',
        brand_id: CLAIMS.brandId, device_id: CLAIMS.deviceId,
        device_role: 'kiosk', device_location_id: CLAIMS.locationId, device_token_version: 1,
      },
    });
    assert.equal(verifyDeviceToken(escalated, KEY, NOW), null);
  });

  it('a malformed identity', () => {
    for (const bad of [
      { device_id: 'not-a-uuid' },
      { device_role: 'barista' },
      { device_token_version: 'one' },
    ]) {
      const token = resign({
        role: 'authenticated', aud: 'authenticated', exp: Math.floor(NOW / 1000) + 3600,
        app_metadata: {
          brand_id: CLAIMS.brandId, device_id: CLAIMS.deviceId, device_role: 'kiosk',
          device_location_id: CLAIMS.locationId, device_token_version: 1, ...bad,
        },
      });
      assert.equal(verifyDeviceToken(token, KEY, NOW), null, JSON.stringify(bad));
    }
  });

  it('anything that is not a token at all', () => {
    for (const bad of ['', 'x', 'a.b', 'a.b.c.d']) {
      assert.equal(verifyDeviceToken(bad, KEY, NOW), null, JSON.stringify(bad));
    }
  });
});

describe('canPlaceOrders', () => {
  it('lets a till and a kiosk ring a sale and refuses the screens that cannot', () => {
    assert.equal(canPlaceOrders('kiosk'), true);
    assert.equal(canPlaceOrders('pos'), true);
    assert.equal(canPlaceOrders('display'), false);
    assert.equal(canPlaceOrders('prep'), false);
  });
});

describe('loadDeviceSigningKey', () => {
  it('explains itself in a sentence rather than throwing a stack', () => {
    assert.throws(() => loadDeviceSigningKey({} as NodeJS.ProcessEnv), (error: unknown) => {
      assert.ok(error instanceof DeviceError);
      assert.equal(error.code, 'not_configured');
      return true;
    });
    assert.throws(() => loadDeviceSigningKey({ SUPABASE_JWT_SECRET: 'short' } as NodeJS.ProcessEnv), DeviceError);
  });
});

/**
 * A screen nobody signs into has to be able to re-authenticate itself.
 *
 * `refreshDeviceToken` needs a currently valid token, so a display whose
 * twelve hours have lapsed has no path back that does not involve a human
 * editing an environment variable. These are the tests for the path that does.
 */
const secretRow = (over: Partial<DeviceRowLike> = {}): DeviceRowLike => ({
  id: CLAIMS.deviceId,
  brand_id: CLAIMS.brandId,
  location_id: CLAIMS.locationId,
  role: 'display',
  label: 'Pickup board',
  pairing_code_hash: null,
  pairing_expires_at: null,
  paired_at: new Date(NOW - 86_400_000).toISOString(),
  revoked_at: null,
  last_seen_at: null,
  token_version: CLAIMS.tokenVersion,
  refresh_secret_hash: null,
  refresh_secret_issued_at: null,
  refresh_secret_previous_hash: null,
  refresh_secret_previous_expires_at: null,
  refresh_secret_last_used_at: null,
  ...over,
});

/**
 * Enough of PostgREST to exercise the compare-and-set writes, the `.or()`
 * lookup and the brand join: filters accumulate, the terminal call applies
 * them to the single row, and a write whose WHERE matches nothing answers null
 * exactly as the real client does -- which is the whole point, because several
 * of these rules are enforced twice, once in TypeScript and once in that WHERE.
 *
 * `PairingQuery` above stays separate: it models two requests interleaving,
 * where this models one request against one row.
 */
type DeviceDbState = {
  row: DeviceRowLike | null;
  slug: string;
  updates: number;
  reads: number;
  inserted: Record<string, unknown> | null;
  readError: string | null;
  writeError: string | null;
  brandsError: string | null;
};

class DeviceQuery {
  private mode: 'read' | 'update' | 'insert' = 'read';
  private readonly equals = new Map<string, unknown>();
  private readonly nulls = new Set<string>();
  private readonly greaterThan = new Map<string, unknown>();
  private orFilter: string | null = null;
  private values: Record<string, unknown> = {};

  constructor(private readonly state: DeviceDbState, private readonly table: string) {}
  select(): this { return this; }
  update(values: Record<string, unknown>): this {
    this.mode = 'update'; this.values = values; return this;
  }
  insert(values: Record<string, unknown>): this {
    this.mode = 'insert'; this.values = values; return this;
  }
  eq(column: string, value: unknown): this { this.equals.set(column, value); return this; }
  is(column: string, _value: unknown): this { this.nulls.add(column); return this; }
  gt(column: string, value: unknown): this { this.greaterThan.set(column, value); return this; }
  or(filter: string): this { this.orFilter = filter; return this; }

  private matches(): boolean {
    const row = this.state.row as (DeviceRowLike & Record<string, unknown>) | null;
    if (!row) return false;
    for (const [column, value] of this.equals) if (row[column] !== value) return false;
    for (const column of this.nulls) if (row[column] !== null && row[column] !== undefined) return false;
    for (const [column, value] of this.greaterThan) {
      if (typeof row[column] !== 'string' || typeof value !== 'string' || row[column] <= value) return false;
    }
    if (this.orFilter) {
      const wanted = this.orFilter.split(',').map((term) => term.split('.eq.'));
      if (!wanted.some(([column, value]) => column && row[column] === value)) return false;
    }
    return true;
  }

  private answer(): { data: unknown; error: { message: string } | null } {
    if (this.mode === 'insert') {
      if (this.state.writeError) return { data: null, error: { message: this.state.writeError } };
      this.state.inserted = this.values;
      return { data: { id: CLAIMS.deviceId }, error: null };
    }
    if (this.mode === 'update' && this.state.writeError) {
      return { data: null, error: { message: this.state.writeError } };
    }
    if (this.table === 'brands') {
      if (this.state.brandsError) return { data: null, error: { message: this.state.brandsError } };
      return { data: { slug: this.state.slug }, error: null };
    }
    if (this.mode === 'read') {
      this.state.reads += 1;
      if (this.state.readError) return { data: null, error: { message: this.state.readError } };
    }
    if (!this.matches()) return { data: null, error: null };
    if (this.mode === 'update' && this.state.row) {
      this.state.updates += 1;
      Object.assign(this.state.row, this.values);
    }
    return { data: { ...(this.state.row as DeviceRowLike) }, error: null };
  }

  async maybeSingle(): Promise<{ data: unknown; error: { message: string } | null }> {
    return this.answer();
  }

  async single(): Promise<{ data: unknown; error: { message: string } | null }> {
    return this.answer();
  }

  // The heartbeat and revoke writes are awaited directly, without .select().
  then<T>(resolve: (value: { error: { message: string } | null }) => T): T {
    return resolve({ error: this.answer().error });
  }
}

const secretDb = (row: DeviceRowLike | null, over: Partial<DeviceDbState> = {}) => {
  const state: DeviceDbState = {
    row,
    slug: 'coffee-story',
    updates: 0,
    reads: 0,
    inserted: null,
    readError: null,
    writeError: null,
    brandsError: null,
    ...over,
  };
  const db = { from: (table: string) => new DeviceQuery(state, table) } as unknown as SupabaseClient;
  return { db, state };
};

/** The row after the call under test, asserted present rather than optional-chained. */
const rowOf = (state: DeviceDbState): DeviceRowLike => {
  assert.ok(state.row, 'the fake was built without a row');
  return state.row;
};

describe('hashRefreshSecret', () => {
  it('is stable for a secret and worthless to a reader of the column', () => {
    // devices_select is brand-wide and includes staff, exactly as for pairing.
    assert.equal(hashRefreshSecret('s3cret-value', KEY), hashRefreshSecret('s3cret-value', KEY));
    assert.notEqual(hashRefreshSecret('s3cret-value', KEY), hashRefreshSecret('s3cret-value', OTHER));
    assert.notEqual(hashRefreshSecret('s3cret-value', KEY), hashRefreshSecret('s3cret-valuf', KEY));
  });

  it('never collides with a pairing hash of the same input', () => {
    // Different domain prefixes, so a leaked pairing hash is not a refresh hash.
    assert.notEqual(hashRefreshSecret('BC234567', KEY), hashPairingCode('BC234567', KEY));
  });
});

describe('newRefreshSecret', () => {
  it('is long enough that online guessing is not the weak link', () => {
    const secret = newRefreshSecret();
    assert.match(secret, /^[A-Za-z0-9_-]+$/);
    assert.ok(secret.length >= 40, `secret was only ${secret.length} characters`);
    assert.equal(new Set(Array.from({ length: 200 }, () => newRefreshSecret())).size, 200);
  });
});

describe('issueDeviceRefreshSecret', () => {
  it('returns the secret once and stores only its hash', async () => {
    const { db, state } = secretDb(secretRow());
    const issued = await issueDeviceRefreshSecret(
      { db, key: KEY, now: () => NOW },
      { brandId: CLAIMS.brandId, deviceId: CLAIMS.deviceId },
    );
    assert.equal(rowOf(state).refresh_secret_hash, hashRefreshSecret(issued.secret, KEY));
    assert.notEqual(rowOf(state).refresh_secret_hash, issued.secret);
    assert.equal(issued.previousExpiresAt, null);
  });

  it('keeps the outgoing secret working for a bounded overlap', async () => {
    const previous = newRefreshSecret();
    const { db, state } = secretDb(secretRow({
      refresh_secret_hash: hashRefreshSecret(previous, KEY),
    }));
    const issued = await issueDeviceRefreshSecret(
      { db, key: KEY, now: () => NOW },
      { brandId: CLAIMS.brandId, deviceId: CLAIMS.deviceId, overlapMinutes: 30 },
    );
    assert.equal(rowOf(state).refresh_secret_previous_hash, hashRefreshSecret(previous, KEY));
    assert.equal(issued.previousExpiresAt, new Date(NOW + 30 * 60_000).toISOString());
  });

  it('refuses a device belonging to another brand', async () => {
    const { db } = secretDb(secretRow());
    await assert.rejects(
      () => issueDeviceRefreshSecret(
        { db, key: KEY, now: () => NOW },
        { brandId: '99999999-9999-4999-8999-999999999999', deviceId: CLAIMS.deviceId },
      ),
      (error: unknown) => error instanceof DeviceError,
    );
  });

  it('refuses a revoked device', async () => {
    const { db } = secretDb(secretRow({ revoked_at: new Date(NOW - 1000).toISOString() }));
    await assert.rejects(
      () => issueDeviceRefreshSecret(
        { db, key: KEY, now: () => NOW },
        { brandId: CLAIMS.brandId, deviceId: CLAIMS.deviceId },
      ),
      (error: unknown) => error instanceof DeviceError && error.code === 'device_revoked',
    );
  });
});

describe('exchangeDeviceRefreshSecret', () => {
  const claimsFor = (row: DeviceRowLike): DeviceClaims => ({
    brandId: row.brand_id,
    deviceId: row.id,
    locationId: row.location_id,
    role: row.role,
    tokenVersion: row.token_version,
  });

  it('mints a token for the current secret and records that the screen is alive', async () => {
    const secret = newRefreshSecret();
    const row = secretRow({ refresh_secret_hash: hashRefreshSecret(secret, KEY) });
    const { db, state } = secretDb(row);
    const token = await exchangeDeviceRefreshSecret({ db, key: KEY, now: () => NOW }, { secret });
    assert.deepEqual(verifyDeviceToken(token.token, KEY, NOW), claimsFor(row));
    assert.equal(rowOf(state).refresh_secret_last_used_at, new Date(NOW).toISOString());
    assert.equal(rowOf(state).last_seen_at, new Date(NOW).toISOString());
  });

  it('honours the outgoing secret inside the overlap and not after it', async () => {
    const previous = newRefreshSecret();
    const inside = secretDb(secretRow({
      refresh_secret_hash: hashRefreshSecret(newRefreshSecret(), KEY),
      refresh_secret_previous_hash: hashRefreshSecret(previous, KEY),
      refresh_secret_previous_expires_at: new Date(NOW + 60_000).toISOString(),
    }));
    assert.ok(await exchangeDeviceRefreshSecret(
      { db: inside.db, key: KEY, now: () => NOW }, { secret: previous },
    ));

    const after = secretDb(secretRow({
      refresh_secret_hash: hashRefreshSecret(newRefreshSecret(), KEY),
      refresh_secret_previous_hash: hashRefreshSecret(previous, KEY),
      refresh_secret_previous_expires_at: new Date(NOW - 1).toISOString(),
    }));
    await assert.rejects(
      () => exchangeDeviceRefreshSecret({ db: after.db, key: KEY, now: () => NOW }, { secret: previous }),
      (error: unknown) => error instanceof DeviceError && error.code === 'pairing_unknown',
    );
  });

  it('answers identically for unknown, revoked and unpaired', async () => {
    // Distinguishing them would turn an unauthenticated endpoint into an
    // oracle for which secrets exist. Same argument as redeemPairingCode.
    const secret = newRefreshSecret();
    const hash = hashRefreshSecret(secret, KEY);
    const cases: DeviceRowLike[] = [
      secretRow({ refresh_secret_hash: hashRefreshSecret(newRefreshSecret(), KEY) }),
      secretRow({ refresh_secret_hash: hash, revoked_at: new Date(NOW - 1000).toISOString() }),
      secretRow({ refresh_secret_hash: hash, paired_at: null }),
    ];
    for (const row of cases) {
      const { db } = secretDb(row);
      await assert.rejects(
        () => exchangeDeviceRefreshSecret({ db, key: KEY, now: () => NOW }, { secret }),
        (error: unknown) => error instanceof DeviceError && error.code === 'pairing_unknown',
      );
    }
  });

  it('rejects a secret too short to be one of ours without touching the database', async () => {
    const db = { from: () => { throw new Error('must not query'); } } as unknown as SupabaseClient;
    await assert.rejects(
      () => exchangeDeviceRefreshSecret({ db, key: KEY, now: () => NOW }, { secret: 'short' }),
      (error: unknown) => error instanceof DeviceError && error.code === 'pairing_unknown',
    );
  });
});

describe('revokeDevice', () => {
  it('clears the refresh secret, so a revoked screen cannot mint a replacement', async () => {
    const { db, state } = secretDb(secretRow({
      refresh_secret_hash: hashRefreshSecret(newRefreshSecret(), KEY),
      refresh_secret_previous_hash: hashRefreshSecret(newRefreshSecret(), KEY),
    }));
    await revokeDevice({ db, key: KEY, now: () => NOW }, {
      brandId: CLAIMS.brandId, deviceId: CLAIMS.deviceId,
    });
    assert.equal(rowOf(state).refresh_secret_hash, null);
    assert.equal(rowOf(state).refresh_secret_previous_hash, null);
    assert.equal(rowOf(state).token_version, 0);
  });
});

/**
 * The only check on the service-role path, where RLS does not apply.
 *
 * Every field gets its own case, because a token is a statement about the past
 * and the row is the present, and any one field having moved has to be enough
 * on its own. Found by mutation: forcing all seven of these guards to false
 * left the whole suite green, because until now the single fake row in this
 * file always agreed with the claim it was checked against.
 */
describe('loadActiveDevice', () => {
  const active = (over: Partial<DeviceRowLike> = {}): DeviceRowLike =>
    secretRow({ role: CLAIMS.role, ...over });

  const load = (row: DeviceRowLike | null) =>
    loadActiveDevice({ db: secretDb(row).db, key: KEY, now: () => NOW }, CLAIMS);

  it('returns the row while every field still matches the claim', async () => {
    const device = await load(active());
    assert.equal(device?.id, CLAIMS.deviceId);
  });

  const moved: [string, Partial<DeviceRowLike> | null][] = [
    ['a device that no longer exists', null],
    ['a device revoked since its token was minted', { revoked_at: new Date(NOW - 1000).toISOString() }],
    ['a device that was never paired', { paired_at: null }],
    ['a token from before the last re-pairing', { token_version: CLAIMS.tokenVersion + 1 }],
    ['a token naming another brand', { brand_id: '99999999-9999-4999-8999-999999999999' }],
    ['a token naming another location', { location_id: '88888888-8888-4888-8888-888888888888' }],
    ['a token claiming a role the row does not have', { role: 'pos' }],
  ];

  for (const [name, over] of moved) {
    it(`refuses ${name}`, async () => {
      assert.equal(await load(over === null ? null : active(over)), null);
    });
  }
});

describe('refreshDeviceToken', () => {
  /**
   * The property the whole service-role path rests on: revocation is immediate
   * rather than taking effect when the current token expires.
   */
  it('refuses a device revoked since its token was minted', async () => {
    const { db } = secretDb(secretRow({ role: CLAIMS.role, revoked_at: new Date(NOW - 1000).toISOString() }));
    await assert.rejects(
      () => refreshDeviceToken({ db, key: KEY, now: () => NOW }, CLAIMS),
      (error: unknown) => error instanceof DeviceError && error.code === 'device_revoked',
    );
  });

  it('dates the replacement from the clock it was given', async () => {
    const { db } = secretDb(secretRow({ role: CLAIMS.role }));
    const refreshed = await refreshDeviceToken({ db, key: KEY, now: () => NOW }, CLAIMS);
    assert.equal(refreshed.expiresAt, new Date(NOW + DEVICE_TOKEN_TTL_SECONDS * 1000).toISOString());
    assert.equal(refreshed.expiresAt, '2027-01-15T20:00:00.000Z');
  });
});

describe('issuePairingCode', () => {
  it('stores only the hash, and dates the expiry from the clock it was given', async () => {
    const { db, state } = secretDb(null);
    const invite = await issuePairingCode({ db, key: KEY, now: () => NOW }, {
      brandId: CLAIMS.brandId, locationId: CLAIMS.locationId, role: 'kiosk', label: 'Lobby kiosk',
    });
    assert.match(invite.code, /^[23456789BCDFGHJKMNPQRSTVWXZ]{8}$/);
    assert.equal(state.inserted?.pairing_code_hash, hashPairingCode(invite.code, KEY));
    assert.notEqual(state.inserted?.pairing_code_hash, invite.code);
    assert.equal(state.inserted?.paired_at, undefined, 'an unredeemed code is not a paired device');
    // Both halves stated, so a change to either the constant or the arithmetic
    // has to be deliberate rather than agreeing with itself.
    assert.equal(PAIRING_TTL_MINUTES, 15);
    assert.equal(invite.expiresAt, new Date(NOW + 15 * 60_000).toISOString());
  });
});

describe('redeemPairingCode refuses', () => {
  const CODE = 'BC234567';
  const pending = (over: Partial<DeviceRowLike> = {}): DeviceRowLike => secretRow({
    role: CLAIMS.role,
    paired_at: null,
    token_version: 1,
    pairing_code_hash: hashPairingCode(CODE, KEY),
    pairing_expires_at: new Date(NOW + 60_000).toISOString(),
    ...over,
  });

  const redeem = (row: DeviceRowLike | null, over: Partial<DeviceDbState> = {}) => {
    const { db, state } = secretDb(row, over);
    return {
      state,
      run: () => redeemPairingCode(
        { db, key: KEY, now: () => NOW },
        { code: CODE, expectedBrandSlug: 'coffee-story' },
      ),
    };
  };

  const unknown = (error: unknown) =>
    error instanceof DeviceError && error.code === 'pairing_unknown';

  it('a code no row holds', async () => {
    await assert.rejects(redeem(null).run, unknown);
  });

  /**
   * The one that is not defence in depth. Pairing binds a white-label binary
   * to the brand compiled into it; with this guard gone the update below still
   * matches, so another tenant's tablet walks away holding a real token for
   * this brand's hardware.
   */
  it('a code belonging to another white-label tenant', async () => {
    await assert.rejects(redeem(pending(), { slug: 'other-roastery' }).run, unknown);
  });

  /**
   * These two are enforced twice: once here and once in the compare-and-clear
   * WHERE of the UPDATE. Mutation cannot tell the layers apart -- deleting
   * either guard leaves the other refusing, so the mutants survive -- and the
   * tests are written against the behaviour rather than against whichever
   * layer happens to catch it.
   */
  it('a revoked device', async () => {
    await assert.rejects(redeem(pending({ revoked_at: new Date(NOW - 1000).toISOString() })).run, unknown);
  });

  it('a code that has expired, including at the exact moment it expires', async () => {
    await assert.rejects(redeem(pending({ pairing_expires_at: new Date(NOW - 1).toISOString() })).run, unknown);
    await assert.rejects(redeem(pending({ pairing_expires_at: new Date(NOW).toISOString() })).run, unknown);
    await assert.rejects(redeem(pending({ pairing_expires_at: null })).run, unknown);
  });

  it('and reports a failed brand lookup as a failure, not as a wrong tenant', async () => {
    await assert.rejects(
      redeem(pending(), { brandsError: 'brands unavailable' }).run,
      (error: unknown) => error instanceof DeviceError && error.code === 'invalid_request',
    );
  });
});

describe('redeemPairingCode', () => {
  /**
   * Redemption bumps the version by exactly one, which is what stops a token
   * minted for an earlier pairing of the same row from being accepted after
   * the hardware has been paired to someone else.
   */
  it('invalidates every token minted for the previous pairing', async () => {
    const code = 'BC234567';
    const row = secretRow({
      role: CLAIMS.role,
      paired_at: null,
      token_version: 1,
      pairing_code_hash: hashPairingCode(code, KEY),
      pairing_expires_at: new Date(NOW + 60_000).toISOString(),
    });
    const { db, state } = secretDb(row);
    const deps = { db, key: KEY, now: () => NOW };
    const token = await redeemPairingCode(deps, { code, expectedBrandSlug: 'coffee-story' });

    assert.equal(rowOf(state).token_version, 2);
    assert.equal(rowOf(state).pairing_code_hash, null, 'single use: the code is cleared as it is redeemed');
    assert.equal(verifyDeviceToken(token.token, KEY, NOW)?.tokenVersion, 2);

    const stale: DeviceClaims = { ...CLAIMS, tokenVersion: 1 };
    assert.equal(await loadActiveDevice(deps, stale), null, 'the pre-pairing token is dead');
  });
});

describe('verifyDeviceToken also rejects', () => {
  const payload = (over: Record<string, unknown> = {}) => ({
    role: 'authenticated',
    aud: 'authenticated',
    exp: Math.floor(NOW / 1000) + 3600,
    app_metadata: {
      brand_id: CLAIMS.brandId,
      device_id: CLAIMS.deviceId,
      device_role: CLAIMS.role,
      device_location_id: CLAIMS.locationId,
      device_token_version: CLAIMS.tokenVersion,
      ...(over.app_metadata as object ?? {}),
    },
    ...over,
  });

  /**
   * The existing `alg none` case is caught by the signature check before the
   * header is ever read, so it cannot show that the header check does anything.
   * This one carries a real HS256 signature over a header that claims
   * otherwise, which is the only shape where the guard is what refuses.
   */
  it('a correctly signed token whose header claims another algorithm', () => {
    assert.deepEqual(verifyDeviceToken(resign(payload()), KEY, NOW), CLAIMS, 'the control');
    for (const alg of ['none', 'RS256', 'HS512']) {
      assert.equal(verifyDeviceToken(resign(payload(), KEY, { alg, typ: 'JWT' }), KEY, NOW), null, alg);
    }
  });

  it('a token whose expiry is the current second, not only one already past', () => {
    assert.equal(verifyDeviceToken(resign(payload({ exp: Math.floor(NOW / 1000) })), KEY, NOW), null);
    assert.deepEqual(verifyDeviceToken(resign(payload({ exp: Math.floor(NOW / 1000) + 1 })), KEY, NOW), CLAIMS);
  });

  // Returning null rather than throwing: this runs on an unauthenticated path,
  // where an exception is a different observable answer from a refusal.
  it('a null app_metadata, without throwing on it', () => {
    assert.equal(verifyDeviceToken(resign(payload({ app_metadata: null })), KEY, NOW), null);
    assert.equal(verifyDeviceToken(resign(payload({ app_metadata: 'nope' })), KEY, NOW), null);
  });

  it('a token version that is a number but not a whole one', () => {
    const token = resign(payload({ app_metadata: { device_token_version: 1.5 } }));
    assert.equal(verifyDeviceToken(token, KEY, NOW), null);
  });
});

describe('DEVICE_TOKEN_TTL_SECONDS', () => {
  /**
   * Stated as a number rather than as itself. The round-trip test above
   * compares exp - iat against this constant, which stays true whatever the
   * constant becomes; this is the assertion a change to the shift length has
   * to get past.
   */
  it('is twelve hours', () => {
    assert.equal(DEVICE_TOKEN_TTL_SECONDS, 43_200);
  });
});

describe('loadDeviceSigningKey', () => {
  it('derives the issuer from the project url, and names itself when there is none', () => {
    const secret = 'a'.repeat(48);
    assert.deepEqual(loadDeviceSigningKey({ SUPABASE_JWT_SECRET: secret, SUPABASE_URL: 'https://p.supabase.co' } as NodeJS.ProcessEnv), {
      secret,
      issuer: 'https://p.supabase.co/auth/v1',
    });
    assert.equal(
      loadDeviceSigningKey({ SUPABASE_JWT_SECRET: secret } as NodeJS.ProcessEnv).issuer,
      'device-pairing',
    );
  });

  // The boundary itself, so "at least 32" cannot drift into "more than 32".
  it('accepts exactly 32 characters and refuses 31', () => {
    assert.equal(loadDeviceSigningKey({ SUPABASE_JWT_SECRET: 'a'.repeat(32) } as NodeJS.ProcessEnv).secret.length, 32);
    assert.throws(() => loadDeviceSigningKey({ SUPABASE_JWT_SECRET: 'a'.repeat(31) } as NodeJS.ProcessEnv), DeviceError);
  });
});

describe('tenantSlugMatches', () => {
  /**
   * The regex tests `expected`, which is the slug compiled into the binary --
   * so the case that proves it does anything is one where the two sides are
   * equal and the guard is the only thing left to refuse.
   */
  it('refuses a compiled-in slug that is not a slug, even against itself', () => {
    for (const bad of ['../coffee-story', 'Coffee-Story', 'coffee story', 'coffee_story', '-coffee', '']) {
      assert.equal(tenantSlugMatches(bad, bad), false, JSON.stringify(bad));
    }
    assert.equal(tenantSlugMatches('coffee-story', 'coffee-story'), true);
  });
});

describe('newRefreshSecret', () => {
  it('carries 256 bits, stated in bytes rather than in characters', () => {
    assert.equal(Buffer.from(newRefreshSecret(), 'base64url').length, 32);
  });
});

describe('issueDeviceRefreshSecret', () => {
  const deps = (db: SupabaseClient) => ({ db, key: KEY, now: () => NOW });
  const input = { brandId: CLAIMS.brandId, deviceId: CLAIMS.deviceId };

  it('defaults the overlap to an hour', async () => {
    const previous = newRefreshSecret();
    const { db } = secretDb(secretRow({ refresh_secret_hash: hashRefreshSecret(previous, KEY) }));
    const issued = await issueDeviceRefreshSecret(deps(db), input);
    assert.equal(REFRESH_SECRET_OVERLAP_MINUTES, 60);
    assert.equal(issued.previousExpiresAt, new Date(NOW + 60 * 60_000).toISOString());
  });

  /**
   * Separate from the revoked case because the compare-and-set write would
   * happily succeed for this row: an unpaired device is not revoked, so this
   * guard is the only thing standing between a half-created device and a
   * credential that re-authenticates it.
   */
  it('refuses a device that was never paired', async () => {
    const { db, state } = secretDb(secretRow({ paired_at: null }));
    await assert.rejects(
      () => issueDeviceRefreshSecret(deps(db), input),
      (error: unknown) => error instanceof DeviceError && error.code === 'device_revoked',
    );
    assert.equal(state.updates, 0, 'and writes nothing on the way out');
  });

  /**
   * The loser of a concurrent rotation. PostgREST answers an UPDATE whose
   * WHERE matched nothing with no row and no error, and the caller must not
   * read that as success: it would walk away holding a secret the database
   * never stored, and the screen would lock itself out at the next refresh.
   */
  it('refuses when another rotation filed its secret first', async () => {
    const row = secretRow({ refresh_secret_hash: hashRefreshSecret(newRefreshSecret(), KEY) });
    const lost = {
      from: () => {
        const write = {
          eq: () => write,
          is: () => write,
          select: () => write,
          maybeSingle: async () => ({ data: null, error: null }),
        };
        return {
          select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: row, error: null }) }) }) }),
          update: () => write,
        };
      },
    } as unknown as SupabaseClient;

    await assert.rejects(
      () => issueDeviceRefreshSecret(deps(lost), input),
      (error: unknown) => error instanceof DeviceError && error.code === 'device_revoked',
    );
  });
});

describe('exchangeDeviceRefreshSecret', () => {
  const unknown = (error: unknown) =>
    error instanceof DeviceError && error.code === 'pairing_unknown';

  /**
   * The length check exists to spend nothing on a caller who is obviously
   * guessing, not to be an extra rule about what a secret is. Both sides of
   * the boundary, so it cannot quietly start refusing real ones.
   */
  it('refuses 15 characters without a query and lets 16 reach the lookup', async () => {
    const forbidden = { from: () => { throw new Error('must not query'); } } as unknown as SupabaseClient;
    await assert.rejects(
      () => exchangeDeviceRefreshSecret({ db: forbidden, key: KEY, now: () => NOW }, { secret: 'x'.repeat(15) }),
      unknown,
    );

    const { db, state } = secretDb(null);
    await assert.rejects(
      () => exchangeDeviceRefreshSecret({ db, key: KEY, now: () => NOW }, { secret: 'x'.repeat(16) }),
      unknown,
    );
    assert.equal(state.reads, 1, 'a 16-character secret is looked up, not dismissed');
  });

  it('refuses the outgoing secret at the exact moment the overlap ends', async () => {
    const previous = newRefreshSecret();
    const { db } = secretDb(secretRow({
      refresh_secret_hash: hashRefreshSecret(newRefreshSecret(), KEY),
      refresh_secret_previous_hash: hashRefreshSecret(previous, KEY),
      refresh_secret_previous_expires_at: new Date(NOW).toISOString(),
    }));
    await assert.rejects(
      () => exchangeDeviceRefreshSecret({ db, key: KEY, now: () => NOW }, { secret: previous }),
      unknown,
    );
  });
});

/**
 * Every entry point turns a failed query into a DeviceError.
 *
 * Written as a table because the failure is the same one eight times: the
 * database said no, and the only wrong answer is to carry on and hand back a
 * token anyway. Mutation found all eight of these branches unexercised.
 */
describe('a failing database', () => {
  const CODE = 'BC234567';
  const SECRET = newRefreshSecret();

  const usable = (): DeviceRowLike => secretRow({
    role: CLAIMS.role,
    paired_at: new Date(NOW - 60_000).toISOString(),
    pairing_code_hash: hashPairingCode(CODE, KEY),
    pairing_expires_at: new Date(NOW + 60_000).toISOString(),
    refresh_secret_hash: hashRefreshSecret(SECRET, KEY),
  });

  const reads: [string, (db: SupabaseClient) => Promise<unknown>][] = [
    ['loadActiveDevice', (db) => loadActiveDevice({ db, key: KEY, now: () => NOW }, CLAIMS)],
    ['refreshDeviceToken', (db) => refreshDeviceToken({ db, key: KEY, now: () => NOW }, CLAIMS)],
    ['redeemPairingCode', (db) => redeemPairingCode({ db, key: KEY, now: () => NOW }, { code: CODE, expectedBrandSlug: 'coffee-story' })],
    ['issueDeviceRefreshSecret', (db) => issueDeviceRefreshSecret({ db, key: KEY, now: () => NOW }, { brandId: CLAIMS.brandId, deviceId: CLAIMS.deviceId })],
    ['exchangeDeviceRefreshSecret', (db) => exchangeDeviceRefreshSecret({ db, key: KEY, now: () => NOW }, { secret: SECRET })],
  ];

  const writes: [string, (db: SupabaseClient) => Promise<unknown>][] = [
    ['issuePairingCode', (db) => issuePairingCode({ db, key: KEY, now: () => NOW }, { brandId: CLAIMS.brandId, locationId: CLAIMS.locationId, role: 'kiosk', label: 'Lobby kiosk' })],
    ['revokeDevice', (db) => revokeDevice({ db, key: KEY, now: () => NOW }, { brandId: CLAIMS.brandId, deviceId: CLAIMS.deviceId })],
    ...reads.filter(([name]) => name !== 'loadActiveDevice'),
  ];

  const invalid = (error: unknown) =>
    error instanceof DeviceError && error.code === 'invalid_request';

  for (const [name, call] of reads) {
    it(`is reported by ${name} rather than read as an empty result`, async () => {
      const { db } = secretDb(usable(), { readError: 'connection reset' });
      await assert.rejects(() => call(db), invalid);
    });
  }

  for (const [name, call] of writes) {
    it(`is reported by ${name} rather than treated as a completed write`, async () => {
      const { db } = secretDb(usable(), { writeError: 'connection reset' });
      await assert.rejects(() => call(db), invalid);
    });
  }
});
