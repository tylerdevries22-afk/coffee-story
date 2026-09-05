import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { canaryResponseMatches, tenantMarkerMatches, verifiedDeployment } from './factory-deployment-sync';

const sha = 'a'.repeat(40);
const digest = `sha256:${'b'.repeat(64)}`;

describe('verifiedDeployment', () => {
  it('accepts a ready production deployment with immutable Git metadata', () => {
    assert.deepEqual(verifiedDeployment({
      uid: 'dpl_123', url: 'tenant-hq-abc.vercel.app', state: 'READY',
      readySubstate: 'PROMOTED', target: 'production',
      meta: { githubCommitSha: sha, factoryArtifactDigest: digest },
    }), {
      uid: 'dpl_123', url: 'https://tenant-hq-abc.vercel.app',
      commitSha: sha, artifactDigest: digest,
    });
  });

  it('rejects previews, malformed hosts, and missing commit provenance', () => {
    assert.equal(verifiedDeployment({
      uid: 'dpl_123', url: 'tenant.example.com', state: 'READY',
      readySubstate: 'PROMOTED', target: 'production',
      meta: { githubCommitSha: sha, factoryArtifactDigest: digest },
    }), null);
    assert.equal(verifiedDeployment({
      uid: 'dpl_123', url: 'tenant.vercel.app', state: 'READY',
      readySubstate: 'PROMOTED', target: 'preview',
      meta: { githubCommitSha: sha, factoryArtifactDigest: digest },
    }), null);
    assert.equal(verifiedDeployment({
      uid: 'dpl_123', url: 'tenant.vercel.app', state: 'READY',
      readySubstate: 'PROMOTED', target: 'production', meta: {},
    }), null);
    assert.equal(verifiedDeployment({
      uid: 'dpl_123', url: 'tenant.vercel.app', state: 'READY',
      readySubstate: 'STAGED', target: 'production',
      meta: { githubCommitSha: sha, factoryArtifactDigest: digest },
    }), null);
  });
});

describe('tenant-bound canary responses', () => {
  it('rejects arbitrary HTML and accepts only the exact tenant marker', async () => {
    const html = (body: string) => new Response(body, {
      headers: { 'content-type': 'text/html; charset=utf-8' },
    });
    assert.equal(await canaryResponseMatches(
      html('<html><body>healthy</body></html>'), 'customer', 'tenant-one', sha,
    ), false);
    assert.equal(await canaryResponseMatches(
      html('<meta content="tenant-two" name="platform-tenant">'), 'customer', 'tenant-one', sha,
    ), false);
    assert.equal(await canaryResponseMatches(
      html('<meta content="tenant-one" name="platform-tenant">'), 'customer', 'tenant-one', sha,
    ), true);
    assert.equal(tenantMarkerMatches(
      '<meta name="platform-tenant" content="tenant-one">', 'tenant-one',
    ), true);
  });

  it('requires HQ health to bind both commit and tenant', async () => {
    assert.equal(await canaryResponseMatches(Response.json({
      ok: true, version: sha.slice(0, 12), tenant: 'tenant-one',
    }), 'hq', 'tenant-one', sha), true);
    assert.equal(await canaryResponseMatches(Response.json({
      ok: true, version: sha.slice(0, 12), tenant: 'tenant-two',
    }), 'hq', 'tenant-one', sha), false);
  });
});
