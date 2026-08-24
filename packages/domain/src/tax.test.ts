import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { taxCentsFor, taxJurisdictionsFromBrandConfig, taxRowsFor } from './tax';

const FOUR: { id: string; label: string; rate: number }[] = [
  { id: 'state', label: 'State Sales Tax', rate: 0.029 },
  { id: 'city', label: 'City Sales Tax', rate: 0.0375 },
  { id: 'rtd', label: 'Transit District Tax', rate: 0.01 },
  { id: 'county', label: 'County Tax', rate: 0.0025 },
];

describe('taxRowsFor', () => {
  /**
   * The invariant the whole module exists for, and the twin of the assertion in
   * packages/engine: each authority is rounded on its own and the total is the
   * SUM OF THE ROWS. One rounding of the combined 7.90% gives 82.95 -> 83 by
   * luck; the rows must add up to what is printed, every time.
   */
  it('rounds each authority on its own so the rows always sum to the total', () => {
    const rows = taxRowsFor(1050, FOUR);
    assert.deepEqual(rows.map((row) => row.amountCents), [30, 39, 11, 3]);
    assert.equal(taxCentsFor(1050, FOUR), 83);
    assert.equal(rows.reduce((total, row) => total + row.amountCents, 0), taxCentsFor(1050, FOUR));
  });

  it('charges nothing for a tenant with no declared authorities', () => {
    assert.deepEqual(taxRowsFor(1050, []), []);
    assert.equal(taxCentsFor(1050, []), 0);
  });

  it('treats a negative or non-finite base as zero rather than crediting tax', () => {
    assert.equal(taxCentsFor(-500, FOUR), 0);
    assert.equal(taxCentsFor(Number.NaN, FOUR), 0);
  });
});

describe('taxJurisdictionsFromBrandConfig', () => {
  it('reads the tenant list off a whole brand config', () => {
    const config = { tax: { jurisdictions: [{ id: 'state', label: 'State', rate: 0.0625 }] } };
    assert.deepEqual(taxJurisdictionsFromBrandConfig(config), [
      { id: 'state', label: 'State', rate: 0.0625 },
    ]);
  });

  it('returns nothing for a tenant that declared none, rather than another shop rates', () => {
    for (const config of [null, undefined, {}, { tax: {} }, { tax: { jurisdictions: 'nope' } }]) {
      assert.deepEqual(taxJurisdictionsFromBrandConfig(config), [], JSON.stringify(config));
    }
  });

  it('drops a rate above 1, which is a percentage somebody forgot to divide', () => {
    // Charging it would render a 290% tax line on a guest-facing screen.
    const config = { tax: { jurisdictions: [
      { id: 'ok', label: 'Fine', rate: 0.029 },
      { id: 'oops', label: 'Percent', rate: 2.9 },
      { id: 'neg', label: 'Negative', rate: -0.01 },
    ] } };
    assert.deepEqual(taxJurisdictionsFromBrandConfig(config).map((j) => j.id), ['ok']);
  });

  it('drops an entry missing an id or a label, and de-duplicates', () => {
    const config = { tax: { jurisdictions: [
      { id: 'a', label: 'A', rate: 0.01 },
      { id: 'a', label: 'Duplicate', rate: 0.02 },
      { id: '', label: 'Nameless', rate: 0.01 },
      { id: 'b', rate: 0.01 },
    ] } };
    assert.deepEqual(taxJurisdictionsFromBrandConfig(config).map((j) => j.label), ['A']);
  });

  /** Never throws: unlike the engine twin, a screen has nowhere to put one. */
  it('never throws for anything a config could contain', () => {
    for (const bad of [0, '', [], { tax: [] }, { tax: { jurisdictions: [null, 7] } }]) {
      assert.doesNotThrow(() => taxJurisdictionsFromBrandConfig(bad));
    }
  });
});
