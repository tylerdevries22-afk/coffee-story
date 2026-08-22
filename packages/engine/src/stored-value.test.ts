import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { coverageFor, nextLedgerBalance } from './stored-value';

describe('nextLedgerBalance', () => {
  it('applies signed movements', () => {
    assert.equal(nextLedgerBalance(2000, { type: 'spend', amountCents: -805 }), 1195);
    assert.equal(nextLedgerBalance(0, { type: 'load', amountCents: 2500 }), 2500);
  });

  it('refuses to go negative rather than minting money', () => {
    assert.throws(() => nextLedgerBalance(100, { type: 'spend', amountCents: -101 }));
  });
});

describe('coverageFor', () => {
  it('splits a total between balance and remainder', () => {
    assert.deepEqual(coverageFor(805, 300), { coveredCents: 300, remainderCents: 505 });
    assert.deepEqual(coverageFor(805, 2000), { coveredCents: 805, remainderCents: 0 });
    assert.deepEqual(coverageFor(805, 0), { coveredCents: 0, remainderCents: 805 });
  });
});
