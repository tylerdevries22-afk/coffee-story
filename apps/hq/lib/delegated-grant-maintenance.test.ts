import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  DELEGATED_GRANT_RETENTION_DAYS,
  delegatedGrantRetentionCutoff,
} from './delegated-grant-maintenance';

describe('delegatedGrantRetentionCutoff', () => {
  it('keeps ended grants 90 days', () => {
    assert.equal(
      delegatedGrantRetentionCutoff(new Date('2026-08-27T20:30:00.000Z')),
      '2026-05-29T20:30:00.000Z',
    );
  });

  it('stays outside the window the database function refuses', () => {
    // prune_delegated_access_grants rejects a cutoff inside the last 30 days,
    // so a retention shortened past that would fail every tick with an error
    // nobody reads until the table has grown.
    assert.ok(DELEGATED_GRANT_RETENTION_DAYS > 30);
  });
});
