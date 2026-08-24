import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { coverageFor } from './stored-value';

describe('coverageFor', () => {
  it('covers what it can and leaves the rest to a card', () => {
    assert.deepEqual(coverageFor(642, 1000), { coveredCents: 642, remainderCents: 0 });
    assert.deepEqual(coverageFor(1000, 642), { coveredCents: 642, remainderCents: 358 });
  });

  it('never lets a balance create money', () => {
    assert.deepEqual(coverageFor(500, -100), { coveredCents: 0, remainderCents: 500 });
    assert.deepEqual(coverageFor(-500, 100), { coveredCents: 0, remainderCents: 0 });
  });

  it('always splits the total exactly, with nothing lost to rounding', () => {
    const cases: [number, number][] = [[642, 1000], [1000, 642], [1, 0], [99999, 12345], [0, 0]];
    for (const [total, balance] of cases) {
      const { coveredCents, remainderCents } = coverageFor(total, balance);
      assert.equal(coveredCents + remainderCents, Math.max(0, total), `${total}/${balance}`);
      assert.ok(Number.isInteger(coveredCents) && Number.isInteger(remainderCents));
    }
  });

  it('truncates rather than rounding, so a split can never exceed the total', () => {
    assert.deepEqual(coverageFor(100.9, 40.9), { coveredCents: 40, remainderCents: 60 });
  });
});
