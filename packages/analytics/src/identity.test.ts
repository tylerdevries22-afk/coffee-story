import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createAnalyticsId,
  createSessionHash,
  screenKeyFor,
  tenantIdHintFromJwt,
} from './identity';

const BRAND_ID = 'e627d6c2-6cb9-4368-8543-abd02a5afb7c';

test('createAnalyticsId creates a UUIDv4', () => {
  assert.match(createAnalyticsId(() => 0.25), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

test('createSessionHash creates a bounded versioned pseudonymous value', () => {
  assert.match(createSessionHash(() => 0.5), /^h1_[A-Za-z0-9_-]{32}$/);
});

test('screenKeyFor returns only allowlisted values', () => {
  const routes = { '/client/home': 'home' };
  assert.equal(screenKeyFor('/client/home?source=email', routes), 'home');
  assert.equal(screenKeyFor('/drops/private-campaign-name', routes), 'unknown');
});

test('tenantIdHintFromJwt reads only a valid hook-minted tenant hint', () => {
  const payload = Buffer.from(JSON.stringify({ app_metadata: { brand_id: BRAND_ID } })).toString('base64url');
  assert.equal(tenantIdHintFromJwt(`header.${payload}.signature`), BRAND_ID);
  assert.equal(tenantIdHintFromJwt('header.invalid.signature'), null);
});
