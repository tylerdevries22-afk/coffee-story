import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { demoTokenHash, isDemoToken } from '../demo-token';
import { demoLinkHash, demoLinkPath, demoLinkSecret, demoLinkToken } from './link';

const SECRET = 'k'.repeat(48);
const SITE = '0f8e3c52-2b1d-4a6e-9c7f-5d4b3a291e10';

describe('demo links', () => {
  it('are tokens the link route accepts, the same every time for one demo', () => {
    const token = demoLinkToken(SECRET, SITE);
    assert.ok(isDemoToken(token), token);
    assert.equal(demoLinkToken(SECRET, SITE), token);
    assert.equal(demoLinkPath(SECRET, SITE), `/d/${token}`);
  });

  it('differ for every demo and under every secret', () => {
    const other = '7a1c9e44-6f0b-4d2a-8e53-0b9c1d2e3f40';
    assert.notEqual(demoLinkToken(SECRET, SITE), demoLinkToken(SECRET, other));
    assert.notEqual(demoLinkToken(SECRET, SITE), demoLinkToken(`${SECRET}x`, SITE));
  });

  it('store as the same hash the link route looks up', () => {
    assert.equal(demoLinkHash(SECRET, SITE), demoTokenHash(demoLinkToken(SECRET, SITE)));
    assert.match(demoLinkHash(SECRET, SITE), /^[0-9a-f]{64}$/);
  });

  it('need a secret long enough to carry real randomness', () => {
    assert.equal(demoLinkSecret({}), null);
    assert.equal(demoLinkSecret({ DEMO_LINK_SECRET: 'short' }), null);
    assert.equal(demoLinkSecret({ DEMO_LINK_SECRET: ` ${SECRET} ` }), SECRET);
  });
});
