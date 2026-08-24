import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { describe, it } from 'node:test';

import type { TenantClaims } from '@platform/schema';

import { authorizeSquareCallback, refusalResponse } from './square-callback-auth';
import { encodeOAuthState, STATE_TTL_SECONDS } from './square-oauth-state';

const SECRET = 'test-application-secret';
const NOW = 1_700_000_000;
const LOCATION = '11111111-1111-4111-8111-111111111111';
const OTHER_LOCATION = '55555555-5555-4555-8555-555555555555';
const USER = '22222222-2222-4222-8222-222222222222';
const BRAND = '33333333-3333-4333-8333-333333333333';
const OTHER_BRAND = '44444444-4444-4444-8444-444444444444';

const OWNER: TenantClaims = { brand_id: BRAND, role: 'brand_owner', location_ids: [] };
const state = (over: Partial<{ locationId: string; userId: string; expiresAt: number }> = {}) =>
  encodeOAuthState(SECRET, {
    locationId: LOCATION, userId: USER, expiresAt: NOW + STATE_TTL_SECONDS, ...over,
  });

function decide(over: Partial<Parameters<typeof authorizeSquareCallback>[0]> = {}) {
  return authorizeSquareCallback({
    secret: SECRET,
    state: state(),
    nowSeconds: NOW,
    sessionUserId: USER,
    claims: OWNER,
    locationBrandId: BRAND,
    ...over,
  });
}

describe('authorizeSquareCallback', () => {
  it('lets the owner who started the connection finish it', () => {
    assert.deepEqual(decide(), { ok: true, locationId: LOCATION });
  });

  it('refuses the legacy state format, which used to be the only one it took', () => {
    // `<location_id>.<mac>` over the location alone: no user, no expiry. The
    // route that minted these asked for no credentials, so anyone could get
    // one for any location -- and this callback honoured them long after the
    // scheme was replaced. Replaying one repointed that shop's Square
    // connection, and its takings, at the replayer's merchant account.
    const legacyMac = createHmac('sha256', SECRET).update(LOCATION).digest('hex').slice(0, 32);
    assert.deepEqual(
      decide({ state: `${LOCATION}.${legacyMac}` }),
      { ok: false, reason: 'invalid_state' },
    );
  });

  it('refuses a forged, tampered or expired state', () => {
    assert.deepEqual(
      decide({ state: encodeOAuthState('someone-elses-secret', { locationId: LOCATION, userId: USER, expiresAt: NOW + 60 }) }),
      { ok: false, reason: 'invalid_state' },
    );
    assert.deepEqual(
      decide({ state: state().replace(LOCATION, OTHER_LOCATION) }),
      { ok: false, reason: 'invalid_state' },
    );
    assert.deepEqual(
      decide({ nowSeconds: NOW + STATE_TTL_SECONDS + 1 }),
      { ok: false, reason: 'invalid_state' },
    );
  });

  it('refuses a browser with no console session', () => {
    assert.deepEqual(decide({ sessionUserId: null }), { ok: false, reason: 'not_signed_in' });
  });

  it('refuses a state finished by a different account', () => {
    // A state captured from history or a proxy log is worthless in someone
    // else's browser, even inside its fifteen minutes.
    assert.deepEqual(
      decide({ sessionUserId: '99999999-9999-4999-8999-999999999999' }),
      { ok: false, reason: 'different_account' },
    );
  });

  it('refuses an account that no longer manages the location', () => {
    const shiftLead: TenantClaims = { brand_id: BRAND, role: 'staff', location_ids: [OTHER_LOCATION] };
    assert.deepEqual(decide({ claims: shiftLead }), { ok: false, reason: 'not_your_location' });
    assert.deepEqual(decide({ claims: null }), { ok: false, reason: 'not_your_location' });
  });

  it('refuses a location belonging to another brand, and one that is gone', () => {
    // Service role reads past RLS after this point, so the claim and the row
    // must be compared here or nowhere.
    assert.deepEqual(decide({ locationBrandId: OTHER_BRAND }), { ok: false, reason: 'not_your_location' });
    assert.deepEqual(decide({ locationBrandId: null }), { ok: false, reason: 'not_your_location' });
  });

  it('tells a stranger the same thing whatever went wrong with their state', () => {
    // Distinguishing "expired" from "forged" from "legacy" would confirm which
    // half of a guess was right; none of them confirms a location exists.
    assert.deepEqual(refusalResponse('invalid_state'), {
      status: 400,
      body: 'This connection link is no longer valid. Start again from Locations.',
    });
    assert.equal(refusalResponse('not_your_location').status, 403);
    assert.equal(refusalResponse('not_signed_in').body, refusalResponse('not_your_location').body);
  });
});
