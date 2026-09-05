import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { deploymentEvidence } from './factory-release-runtime';

const digest = `sha256:${'a'.repeat(64)}`;

describe('deploymentEvidence', () => {
  it('accepts tenant-bound canary and promotion evidence', () => {
    assert.deepEqual(deploymentEvidence({
      tenantSlug: 'stillpoint-builders', artifactDigest: digest, commitSha: 'b'.repeat(40),
      canary: { status: 'passed', providerReference: 'vercel:canary-1' },
      promotion: { status: 'promoted', providerReference: 'vercel:production-1' },
    }, 'stillpoint-builders', digest), {
      artifactDigest: digest, commitSha: 'b'.repeat(40), canaryStatus: 'passed',
      canaryReference: 'vercel:canary-1', promotionReference: 'vercel:production-1',
    });
  });

  it('rejects cross-tenant, stale, and malformed release evidence', () => {
    const base = {
      tenantSlug: 'stillpoint-builders', artifactDigest: digest, commitSha: 'b'.repeat(40),
      canary: { status: 'passed', providerReference: 'vercel:canary-1' },
    };
    assert.equal(deploymentEvidence({ ...base, tenantSlug: 'coffee-story' }, 'stillpoint-builders', digest), null);
    assert.equal(deploymentEvidence({ ...base, artifactDigest: `sha256:${'c'.repeat(64)}` }, 'stillpoint-builders', digest), null);
    assert.equal(deploymentEvidence({ ...base, commitSha: 'main' }, 'stillpoint-builders', digest), null);
  });
});
