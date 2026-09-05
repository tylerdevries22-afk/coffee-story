import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { githubArtifactDigest } from './factory-github-actions';

describe('githubArtifactDigest', () => {
  it('accepts only a canonical factory content digest', () => {
    const digest = `sha256:${'a'.repeat(64)}`;
    assert.equal(githubArtifactDigest(` ${digest} `), digest);
    assert.throws(() => githubArtifactDigest('sha256:ABC'), /artifact digest is invalid/);
    assert.throws(() => githubArtifactDigest(''), /artifact digest is invalid/);
  });
});
