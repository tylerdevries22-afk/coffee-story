import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { readSnapshotLines } from './order-snapshot';

/** Exactly what packages/engine writes today. */
const WRITTEN = {
  lines: [
    { item_slug: 'latte', name: 'Latte', quantity: 2, unit_price_cents: 500, options: ['Oat milk'], note: '' },
    { item_slug: 'mochi-donut', name: 'Mochi Donut', quantity: 1, unit_price_cents: 350, options: [], note: 'warm' },
  ],
  subtotal_cents: 1350,
};

describe('readSnapshotLines', () => {
  it('reads back exactly what the engine wrote, price included', () => {
    // The operator's mirror omitted unit_price_cents entirely, which is why the
    // KDS could never show a line price.
    const lines = readSnapshotLines(WRITTEN);
    assert.equal(lines.length, 2);
    assert.deepEqual(lines[0], {
      itemSlug: 'latte', name: 'Latte', quantity: 2, unitPriceCents: 500,
      options: ['Oat milk'], note: '', packContents: [],
    });
    assert.equal(lines[1]?.note, 'warm');
  });

  it('never throws on anything a stored row could contain', () => {
    for (const bad of [null, undefined, 0, '', [], {}, { lines: 'nope' }, { lines: [null, 7, 'x'] }]) {
      assert.deepEqual(readSnapshotLines(bad), [], JSON.stringify(bad));
    }
  });

  it('drops a nameless line rather than rendering a phantom item', () => {
    // A ticket listing "Item x1" that nobody ordered is worse than a ticket
    // listing one fewer.
    const lines = readSnapshotLines({ lines: [{ quantity: 3 }, { name: 'Real', quantity: 1 }] });
    assert.deepEqual(lines.map((line) => line.name), ['Real']);
  });

  it('falls back to the slug when only the name is missing', () => {
    const lines = readSnapshotLines({ lines: [{ item_slug: 'cortado', quantity: 1 }] });
    assert.equal(lines[0]?.name, 'cortado');
  });

  it('defaults a missing quantity to one and a missing price to zero', () => {
    const lines = readSnapshotLines({ lines: [{ name: 'Latte' }] });
    assert.equal(lines[0]?.quantity, 1);
    assert.equal(lines[0]?.unitPriceCents, 0);
  });

  it('refuses a negative or fractional quantity from a corrupted row', () => {
    const lines = readSnapshotLines({ lines: [{ name: 'A', quantity: -3 }, { name: 'B', quantity: 2.7 }] });
    assert.equal(lines[0]?.quantity, 1);
    assert.equal(lines[1]?.quantity, 2);
  });

  it('keeps only string options', () => {
    const lines = readSnapshotLines({ lines: [{ name: 'A', options: ['Oat', 5, null, 'Extra shot'] }] });
    assert.deepEqual(lines[0]?.options, ['Oat', 'Extra shot']);
  });

  it('reads structured pack contents and drops malformed recipe entries', () => {
    const lines = readSnapshotLines({
      lines: [{
        name: 'Brew Box',
        pack_contents: [
          { item_slug: 'v60', name: 'V60', quantity: 3 },
          { item_slug: 'kenya', quantity: 1 },
          { item_slug: 'broken', name: 'Broken', quantity: 0 },
        ],
      }],
    });
    assert.deepEqual(lines[0]?.packContents, [
      { itemSlug: 'v60', name: 'V60', quantity: 3 },
      { itemSlug: 'kenya', name: 'kenya', quantity: 1 },
    ]);
  });
});
