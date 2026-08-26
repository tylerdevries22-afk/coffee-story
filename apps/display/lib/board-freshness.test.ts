import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { boardFreshness } from './board-freshness';

describe('boardFreshness', () => {
  it('surfaces a synchronized demo outage instead of labeling fixtures healthy', () => {
    assert.equal(boardFreshness(false, true, 0, 0, 90_000), 'stale');
  });

  it('distinguishes normal fixtures, fresh live reads, and stale live reads', () => {
    assert.equal(boardFreshness(false, false, 0, 100_000, 90_000), 'fixtures');
    assert.equal(boardFreshness(true, false, 10_000, 20_000, 90_000), 'live');
    assert.equal(boardFreshness(true, false, 10_000, 100_001, 90_000), 'stale');
  });
});
