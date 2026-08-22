import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { loyaltyProgress } from './loyalty-logic';

describe('loyaltyProgress', () => {
  it('reports position inside the current reward band', () => {
    assert.deepEqual(loyaltyProgress(130, 100), { fraction: 0.3, pointsIntoTier: 30, pointsToNext: 70 });
  });

  it('shows an empty meter right after a reward', () => {
    assert.deepEqual(loyaltyProgress(200, 100), { fraction: 0, pointsIntoTier: 0, pointsToNext: 100 });
  });

  it('fails safe on nonsense input', () => {
    assert.deepEqual(loyaltyProgress(-5, 100), { fraction: 0, pointsIntoTier: 0, pointsToNext: 100 });
    assert.deepEqual(loyaltyProgress(50, 0), { fraction: 0, pointsIntoTier: 0, pointsToNext: 0 });
  });
});
