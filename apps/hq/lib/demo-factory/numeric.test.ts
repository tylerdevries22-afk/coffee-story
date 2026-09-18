import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { count } from './numeric';

describe('count', () => {
  it('parses a stringified bigint', () => {
    assert.equal(count('42'), 42);
  });

  it('passes a plain number through, truncated', () => {
    assert.equal(count(3.9), 3);
  });

  it('treats anything else -- missing, negative, non-numeric -- as zero', () => {
    for (const value of [undefined, null, 'lots', -1, NaN, {}, []]) {
      assert.equal(count(value), 0, JSON.stringify(value));
    }
  });
});
