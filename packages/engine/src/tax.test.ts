import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { parseTaxJurisdictions, taxCentsFor, taxRowsFor } from './tax';

const FOUR_AUTHORITIES = [
  { id: 'state', label: 'State', rate: 0.029 },
  { id: 'city', label: 'City', rate: 0.0375 },
  { id: 'rtd', label: 'RTD', rate: 0.01 },
  { id: 'county', label: 'County', rate: 0.0025 },
] as const;

describe('taxRowsFor', () => {
  it('rounds each authority on its own so rows always sum to the total', () => {
    // 1050 * 7.9% = 82.95 if rounded once; the per-row sum differs and is
    // what both the receipt and the orders row must carry.
    const rows = taxRowsFor(1050, FOUR_AUTHORITIES);
    assert.deepEqual(rows.map((row) => row.amountCents), [30, 39, 11, 3]);
    assert.equal(taxCentsFor(1050, FOUR_AUTHORITIES), 83);
  });

  it('treats a negative or non-finite base as zero', () => {
    assert.equal(taxCentsFor(-500, FOUR_AUTHORITIES), 0);
    assert.equal(taxCentsFor(Number.NaN, FOUR_AUTHORITIES), 0);
  });

  it('charges nothing with an empty jurisdiction list', () => {
    assert.equal(taxCentsFor(1050, []), 0);
  });
});

describe('parseTaxJurisdictions', () => {
  it('reads the brand_config shape', () => {
    const parsed = parseTaxJurisdictions({ tax: { jurisdictions: [...FOUR_AUTHORITIES] } });
    assert.equal(parsed.length, 4);
    assert.equal(parsed[1]!.rate, 0.0375);
  });

  it('returns empty when the brand states no tax config', () => {
    assert.deepEqual(parseTaxJurisdictions({}), []);
    assert.deepEqual(parseTaxJurisdictions(null), []);
  });

  it('rejects a malformed list instead of dropping entries', () => {
    assert.throws(() => parseTaxJurisdictions({ tax: { jurisdictions: [{ id: 'x' }] } }));
    assert.throws(() => parseTaxJurisdictions({ tax: { jurisdictions: [{ id: 'x', label: 'X', rate: 1.5 }] } }));
    assert.throws(() => parseTaxJurisdictions({ tax: { jurisdictions: 'nope' } }));
  });
});
