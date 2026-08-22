import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  MAX_PIN_ATTEMPTS,
  isLockedOut,
  isValidPin,
  lockoutSeconds,
  recordMiss,
  recordSuccess,
} from './pin-lock';

const NOW = new Date('2026-08-22T12:00:00Z');

describe('isValidPin', () => {
  it('accepts four to six digits and nothing else', () => {
    assert.equal(isValidPin('1234'), true);
    assert.equal(isValidPin('123456'), true);
    assert.equal(isValidPin('123'), false);
    assert.equal(isValidPin('1234567'), false);
    assert.equal(isValidPin('12a4'), false);
  });
});

describe('lockout', () => {
  it('stays open until the attempt ceiling, then backs off doubling', () => {
    assert.equal(lockoutSeconds(MAX_PIN_ATTEMPTS - 1), 0);
    assert.equal(lockoutSeconds(MAX_PIN_ATTEMPTS), 30);
    assert.equal(lockoutSeconds(MAX_PIN_ATTEMPTS + 1), 60);
    assert.equal(lockoutSeconds(MAX_PIN_ATTEMPTS + 10), 900); // capped
  });

  it('walks miss -> locked -> success -> clear', () => {
    let state = { missCount: 0, lockedUntil: null as string | null };
    for (let i = 0; i < MAX_PIN_ATTEMPTS; i += 1) state = recordMiss(state, NOW);
    assert.equal(isLockedOut(state, NOW), true);
    assert.equal(isLockedOut(state, new Date(NOW.getTime() + 31_000)), false);
    state = recordSuccess();
    assert.equal(state.missCount, 0);
    assert.equal(isLockedOut(state, NOW), false);
  });
});
