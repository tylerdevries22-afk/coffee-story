import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { batchScale } from './prep';

describe('batchScale', () => {
  it('doubles a target of twice the yield', () => {
    assert.equal(batchScale({ yield_qty: 12 }, 24), 2);
  });

  it('returns a fraction for a part batch rather than rounding it away', () => {
    assert.equal(batchScale({ yield_qty: 12 }, 6), 0.5);
  });

  it('falls back to 1 on a nonsense yield instead of dividing by zero', () => {
    // A recipe with no yield is a data error, not a reason to print Infinity
    // beside a quantity someone is about to weigh out.
    assert.equal(batchScale({ yield_qty: 0 }, 24), 1);
    assert.equal(batchScale({ yield_qty: -3 }, 24), 1);
  });
});
