import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { resetExperience } from './experience-reset';

describe('resetExperience', () => {
  it('clears cart, identity, and builder before navigating', () => {
    const calls: string[] = [];
    resetExperience({
      resetSession: () => calls.push('session'),
      clearGuest: () => calls.push('guest'),
      resetBuilder: () => calls.push('builder'),
      navigate: () => calls.push('navigate'),
    });
    assert.deepEqual(calls, ['session', 'guest', 'builder', 'navigate']);
  });

  it('does not recursively reset a session whose idle clock already fired', () => {
    const calls: string[] = [];
    resetExperience({
      resetSession: () => calls.push('session'),
      clearGuest: () => calls.push('guest'),
      resetBuilder: () => calls.push('builder'),
      navigate: () => calls.push('navigate'),
    }, true);
    assert.deepEqual(calls, ['guest', 'builder', 'navigate']);
  });
});
