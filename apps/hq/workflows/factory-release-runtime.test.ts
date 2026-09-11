import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  deploymentEvidence,
  publicationApplied,
  publicationExpectation,
} from './factory-release-runtime';

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

describe('publicationExpectation', () => {
  it('preserves an absent publication as an exact nullable tuple', () => {
    assert.deepEqual(publicationExpectation(null), {
      p_previous_release_id: null, p_previous_artifact_digest: null,
      p_previous_commit_sha: null, p_previous_published_at: null,
    });
  });

  it('preserves every current value and rejects an incomplete tuple', () => {
    const row = {
      current_release_id: '123e4567-e89b-42d3-a456-426614174000',
      artifact_digest: digest, deployment_commit_sha: 'b'.repeat(40),
      published_at: '2026-09-08T12:34:56.000Z',
    };
    assert.deepEqual(publicationExpectation(row), {
      p_previous_release_id: row.current_release_id,
      p_previous_artifact_digest: digest,
      p_previous_commit_sha: row.deployment_commit_sha,
      p_previous_published_at: row.published_at,
    });
    assert.throws(
      () => publicationExpectation({ ...row, artifact_digest: `sha256:${'c'.repeat(63)}` }),
      /publication state is invalid/,
    );
  });

  it('reconciles only one immutable event with the exact current pointer', () => {
    const target = {
      releaseId: '123e4567-e89b-42d3-a456-426614174000', artifactDigest: digest,
      commitSha: 'b'.repeat(40), canaryReference: 'release-set:sha256:abc',
      approvalReference: 'github:123:1',
    };
    const event = { package_release_id: target.releaseId, artifact_digest: digest,
      deployment_commit_sha: target.commitSha, canary_reference: target.canaryReference,
      approval_reference: target.approvalReference, promoted_at: '2026-09-08T12:34:56Z' };
    const pointer = { current_release_id: target.releaseId, artifact_digest: digest,
      deployment_commit_sha: target.commitSha, published_at: event.promoted_at };
    assert.equal(publicationApplied([event], [pointer], target), true);
    assert.equal(publicationApplied([event], [], target), false);
    assert.equal(publicationApplied([event], [{ ...pointer, current_release_id: null }], target), false);
    assert.equal(publicationApplied([event, event], [pointer], target), false);
  });
});
