import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { parseTenantClaims } from '@platform/schema';

import { brandNameFromMetadata, tokenAppMetadata } from './token-claims';

function jwt(payload: unknown): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode(payload)}.signature`;
}

const HOOK_MINTED = {
  sub: '11111111-1111-4111-8111-111111111111',
  app_metadata: {
    brand_id: '22222222-2222-4222-8222-222222222222',
    brand_name: 'Demo Roastery',
    role: 'location_manager',
    location_ids: ['33333333-3333-4333-8333-333333333333'],
  },
};

describe('tokenAppMetadata', () => {
  it('reads the tenancy the hook minted into the token', () => {
    const metadata = tokenAppMetadata(jwt(HOOK_MINTED));
    const claims = parseTenantClaims(metadata);
    assert.equal(claims?.role, 'location_manager');
    assert.equal(claims?.brand_id, HOOK_MINTED.app_metadata.brand_id);
    assert.deepEqual(claims?.location_ids, HOOK_MINTED.app_metadata.location_ids);
    assert.equal(brandNameFromMetadata(metadata), 'Demo Roastery');
  });

  it('is why the user record is the wrong place to look', () => {
    // getUser() returns the app_metadata STORED on the user row. The hook
    // writes to the token and never to the row, so that object is empty and
    // every role gate reading it answered false for every role.
    const storedOnTheUserRow = {};
    assert.equal(parseTenantClaims(storedOnTheUserRow), null);
    assert.notEqual(parseTenantClaims(tokenAppMetadata(jwt(HOOK_MINTED))), null);
  });

  it('returns null rather than throwing on anything that is not a token', () => {
    for (const value of ['', 'not.a.jwt', 'onepart', jwt(null), jwt('a string'), jwt([1, 2]),
      `${Buffer.from('{').toString('base64url')}.${Buffer.from('{').toString('base64url')}.x`]) {
      assert.equal(tokenAppMetadata(value), null, JSON.stringify(value).slice(0, 40));
    }
    assert.equal(tokenAppMetadata(jwt({ sub: 'x' })), null); // no app_metadata at all
  });

  it('treats a blank or missing brand name as absent', () => {
    assert.equal(brandNameFromMetadata(null), null);
    assert.equal(brandNameFromMetadata({}), null);
    assert.equal(brandNameFromMetadata({ brand_name: '   ' }), null);
    assert.equal(brandNameFromMetadata({ brand_name: 42 }), null);
  });
});
