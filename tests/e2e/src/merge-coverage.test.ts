import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { coverageLinePercent } from './merge-coverage.ts';

describe('merged coverage gate', () => {
  it('reads a finite line percentage at the report boundary', () => {
    assert.equal(coverageLinePercent({ total: { lines: { pct: 70.01 } } }), 70.01);
  });

  it('rejects missing, nonnumeric, and nonfinite percentages', () => {
    assert.throws(() => coverageLinePercent({}), /no numeric/);
    assert.throws(() => coverageLinePercent({ total: { lines: { pct: '70' } } }), /no numeric/);
    assert.throws(() => coverageLinePercent({ total: { lines: { pct: Number.NaN } } }), /no numeric/);
  });
});
