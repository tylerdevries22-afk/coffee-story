import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { demoSyncEnabled } from './demo-sync';

describe('demoSyncEnabled', () => {
  it('never enables the local broker for a live session', () => {
    assert.equal(demoSyncEnabled(false, true), false);
    assert.equal(demoSyncEnabled(true, false), false);
    assert.equal(demoSyncEnabled(true, true), true);
  });
});
