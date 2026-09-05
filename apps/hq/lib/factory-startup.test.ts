import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { factoryStartupDecision } from './factory-startup';

describe('factoryStartupDecision', () => {
  it('creates a run only when no tenant run exists', () => {
    assert.equal(factoryStartupDecision(null), 'create');
  });

  it('restarts recoverable runs', () => {
    for (const state of ['draft', 'blocked', 'failed']) {
      assert.equal(factoryStartupDecision({ state }), 'restart');
    }
  });

  it('reuses active and completed runs without starting duplicates', () => {
    for (const state of ['running', 'live']) {
      assert.equal(factoryStartupDecision({ state }), 'reuse');
    }
  });

  it('fails closed for rolled-back, unknown, or malformed states', () => {
    for (const state of ['rolled_back', 'paused', '', null]) {
      assert.equal(factoryStartupDecision({ state }), 'reject');
    }
  });
});
