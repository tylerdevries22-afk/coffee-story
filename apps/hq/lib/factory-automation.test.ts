import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  availableFactoryCredentialKeys,
  buildFactoryApplicationManifest,
  parseBrandResearchArtifact,
} from './factory-automation';

describe('availableFactoryCredentialKeys', () => {
  it('requires every value in a least-privilege provider credential set', () => {
    const keys = availableFactoryCredentialKeys({
      OPENAI_API_KEY: 'secret', OPENAI_RESEARCH_MODEL: 'model',
      VERCEL_TOKEN: 'secret',
    });
    assert.deepEqual(keys, ['openai.api_key']);
  });

  it('accepts GitHub only when app and template configuration are complete', () => {
    const keys = availableFactoryCredentialKeys({
      GITHUB_APP_ID: '123',
      GITHUB_APP_INSTALLATION_ID: '456',
      GITHUB_APP_PRIVATE_KEY: 'private-key',
      GITHUB_REPOSITORY_OWNER: 'platform-owner',
      GITHUB_TEMPLATE_OWNER: 'platform-owner',
      GITHUB_TEMPLATE_REPOSITORY: 'app-template',
    });
    assert.deepEqual(keys, ['github.app']);
  });
});

describe('parseBrandResearchArtifact', () => {
  it('accepts sourced HTTPS research and normalizes colors', () => {
    const artifact = parseBrandResearchArtifact({ summary: 'A sufficiently detailed public brand summary.', colors: ['#aabbcc', '#112233'], logoSourceUrl: 'https://example.com/logo.svg', sources: [{ title: 'Official site', url: 'https://example.com' }] });
    assert.deepEqual(artifact?.colors, ['#AABBCC', '#112233']);
  });

  it('rejects unsourced or unsafe generated brand claims', () => {
    assert.equal(parseBrandResearchArtifact({ summary: 'Too short', colors: ['red'], sources: [] }), null);
  });
});

describe('buildFactoryApplicationManifest', () => {
  it('preserves the declared surface matrix and a fail-closed release policy', () => {
    const manifest = buildFactoryApplicationManifest(
      { businessName: 'Juniper Coffee', tenantSlug: 'juniper-coffee', industryKey: 'coffee-shop', locationName: 'Downtown', surfaces: ['hq', 'customer', 'operator'] },
      { summary: 'A sufficiently detailed public brand summary.', colors: ['#AABBCC', '#112233'], sources: [{ title: 'Official', url: 'https://example.com' }] },
    );
    assert.deepEqual(manifest.surfaces, ['hq', 'customer', 'operator']);
    assert.deepEqual(manifest.deployments, [
      { surface: 'hq', web: true, native: false },
      { surface: 'customer', web: true, native: true },
      { surface: 'operator', web: true, native: true },
    ]);
    assert.deepEqual(manifest.releasePolicy, { publishMode: 'atomic', failClosed: true, fallback: 'last_valid_release' });
  });
});
