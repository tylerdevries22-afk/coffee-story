import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { IDLE_RESET_MS, IDLE_WARN_MS, idlePhase, secondsUntilReset } from './idle';

describe('idlePhase', () => {
  it('stays active while the guest is deciding', () => {
    assert.equal(idlePhase(0, true), 'active');
    assert.equal(idlePhase(IDLE_WARN_MS - 1, true), 'active');
  });

  it('warns before it resets, never instead of it', () => {
    assert.equal(idlePhase(IDLE_WARN_MS, true), 'warning');
    assert.equal(idlePhase(IDLE_RESET_MS - 1, true), 'warning');
    assert.equal(idlePhase(IDLE_RESET_MS, true), 'reset');
  });

  it('never counts down an untouched attract screen', () => {
    // Otherwise a kiosk nobody is using blanks itself every ninety seconds all
    // day, which looks broken to the room.
    assert.equal(idlePhase(IDLE_RESET_MS * 10, false), 'active');
  });

  it('gives the guest the whole warning window to come back', () => {
    assert.equal(IDLE_RESET_MS - IDLE_WARN_MS, 30_000);
  });
});

describe('secondsUntilReset', () => {
  it('counts down in whole seconds', () => {
    assert.equal(secondsUntilReset(IDLE_WARN_MS), 30);
    assert.equal(secondsUntilReset(IDLE_RESET_MS - 1_500), 2);
  });

  it('floors at zero rather than going negative', () => {
    assert.equal(secondsUntilReset(IDLE_RESET_MS + 5_000), 0);
  });
});
