import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';

import {
  connectorAuthorizationUrl,
  connectorCredentialEnvKeys,
  connectorProviderReady,
  isOAuthConnectorKey,
  visibleCredentialEnvKeys,
} from './connector-oauth-providers';
import { configureOauthTestEnv, restoreOauthTestEnv } from './connector-oauth-test-helpers';

afterEach(() => {
  mock.restoreAll();
  restoreOauthTestEnv();
});

describe('publishing and social OAuth provider configuration', { concurrency: false }, () => {
  it('shows deployment secret names only to an organization owner', () => {
    assert.deepEqual(
      visibleCredentialEnvKeys('meta-business-suite', { isOrganizationOwner: true }),
      ['META_APP_ID', 'META_APP_SECRET'],
    );
    for (const viewer of [null, { isOrganizationOwner: false }]) {
      assert.deepEqual(visibleCredentialEnvKeys('meta-business-suite', viewer), []);
    }
  });

  it('lists env names only for providers whose adapter reads them', () => {
    for (const key of ['meta-business-suite', 'youtube', 'tiktok', 'square']) {
      assert.ok(connectorCredentialEnvKeys(key).length > 0, `${key} is wired`);
    }
    for (const key of ['transistor', 'beehiiv', 'supabase', 'vercel', 'sentry',
      'kindle-direct-publishing', 'acx-audiobooks', 'github']) {
      assert.deepEqual(connectorCredentialEnvKeys(key), [], `${key} has no adapter env`);
    }
  });

  it('registers the three new providers as OAuth connector keys', () => {
    for (const key of ['meta-business-suite', 'youtube', 'tiktok']) {
      assert.ok(isOAuthConnectorKey(key), `${key} should be an OAuth key`);
    }
  });

  it('reports every new provider unconfigured until both secrets are present', () => {
    for (const key of ['meta-business-suite', 'youtube', 'tiktok'] as const) {
      assert.equal(connectorProviderReady(key), false, `${key} must fail closed`);
    }
    configureOauthTestEnv();
    for (const key of ['meta-business-suite', 'youtube', 'tiktok'] as const) {
      assert.equal(connectorProviderReady(key), true);
    }
  });

  it('names TikTok client_key and comma-separates its scopes', () => {
    configureOauthTestEnv();
    const url = connectorAuthorizationUrl(
      'tiktok', 'signed-state', 'challenge', 'https://hq.example.com/api/connectors/tiktok/callback',
    );
    assert.equal(url?.origin, 'https://www.tiktok.com');
    assert.equal(url?.pathname, '/v2/auth/authorize/');
    assert.equal(url?.searchParams.get('client_key'), 'tiktok-key');
    assert.equal(url?.searchParams.get('client_id'), null);
    assert.equal(url?.searchParams.get('code_challenge_method'), null);
    assert.equal(url?.searchParams.get('code_challenge'), null);
    assert.match(url?.searchParams.get('scope') ?? '', /^user\.info\.basic,/);
  });

  it('builds a versioned Meta dialog without unsupported PKCE parameters', () => {
    configureOauthTestEnv();
    const url = connectorAuthorizationUrl(
      'meta-business-suite', 'signed-state', 'challenge',
      'https://hq.example.com/api/connectors/meta-business-suite/callback',
    );
    assert.equal(url?.origin, 'https://www.facebook.com');
    assert.equal(url?.pathname, '/v25.0/dialog/oauth');
    assert.equal(url?.searchParams.get('client_id'), 'meta-app');
    assert.equal(url?.searchParams.get('code_challenge'), null);
    assert.match(url?.searchParams.get('scope') ?? '', /business_management/);
  });

  it('asks Google for offline YouTube scopes so refresh tokens arrive', () => {
    configureOauthTestEnv();
    const url = connectorAuthorizationUrl(
      'youtube', 'signed-state', 'challenge', 'https://hq.example.com/api/connectors/youtube/callback',
    );
    assert.equal(url?.origin, 'https://accounts.google.com');
    assert.equal(url?.searchParams.get('access_type'), 'offline');
    assert.match(url?.searchParams.get('scope') ?? '', /youtube\.upload/);
    assert.match(url?.searchParams.get('scope') ?? '', /yt-analytics\.readonly/);
  });
});
