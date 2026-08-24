import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { PrepBatchRow } from '@platform/schema';

import { batchScale, mergePrepBoardEntry, type PrepBoardEntry } from './prep';

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

describe('mergePrepBoardEntry', () => {
  it('keeps the joined recipe when Realtime sends the base row', () => {
    const row: PrepBatchRow = {
      id: 'batch-1', brand_id: 'brand-1', location_id: 'location-1', recipe_id: 'recipe-1',
      service_date: '2026-08-24', target_qty: 12, produced_qty: 0, status: 'pending',
      assigned_to: null, started_at: null, completed_at: null,
      created_at: '2026-08-24T10:00:00Z', updated_at: '2026-08-24T10:00:00Z',
    };
    const entry: PrepBoardEntry = {
      ...row,
      itemName: 'Milk Cake',
      recipe: {
        id: 'recipe-1', menu_item_id: 'item-1', version: 1, steps: [],
        yield_qty: 12, yield_unit: 'slices', allergens: ['dairy'],
      },
    };
    const [updated] = mergePrepBoardEntry([entry], {
      ...row, status: 'done', produced_qty: 12,
    });
    assert.equal(updated?.status, 'done');
    assert.equal(updated?.recipe.yield_unit, 'slices');
  });
});
