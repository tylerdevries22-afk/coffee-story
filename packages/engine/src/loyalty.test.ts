import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { applyLedger, pointsEarnedFor, pointsToReverse } from './loyalty';

describe('pointsEarnedFor', () => {
  it('earns per whole dollar, floored', () => {
    assert.equal(pointsEarnedFor(467), 46);
    assert.equal(pointsEarnedFor(99), 9);
    assert.equal(pointsEarnedFor(0), 0);
  });
});

describe('pointsToReverse', () => {
  it('reverses proportionally on a partial refund', () => {
    assert.equal(pointsToReverse(100, 1000, 500), 50);
  });

  it('reverses everything on a full refund and never more than earned', () => {
    assert.equal(pointsToReverse(46, 805, 805), 46);
    assert.equal(pointsToReverse(46, 805, 9999), 46);
  });

  it('reverses nothing for zero-value input', () => {
    assert.equal(pointsToReverse(0, 805, 805), 0);
    assert.equal(pointsToReverse(46, 805, 0), 0);
  });
});

describe('applyLedger', () => {
  it('clamps at zero rather than going negative', () => {
    assert.equal(applyLedger(30, -50), 0);
    assert.equal(applyLedger(30, 20), 50);
  });
});
