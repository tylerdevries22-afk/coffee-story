import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { describe, it } from 'node:test';

import {
  DEVICE_TOKEN_TTL_SECONDS, DeviceError, canPlaceOrders, hashPairingCode,
  loadDeviceSigningKey, newPairingCode, normalizeCode, signDeviceToken, verifyDeviceToken,
  type DeviceClaims, type DeviceSigningKey,
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

const resign = (payload: object, key = KEY) => {
  const b = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const head = b({ alg: 'HS256', typ: 'JWT' });
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
