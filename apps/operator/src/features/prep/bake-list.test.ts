import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { PrepBoardEntry } from '@platform/data';

import { bakeProgress, multiplierLabel, recipeSteps, sortBakeList } from './bake-list';

function batch(over: Partial<PrepBoardEntry> & { id: string }): PrepBoardEntry {
  return {
    brand_id: 'brand-1', location_id: 'location-1', recipe_id: 'recipe-1',
    service_date: '2026-08-24', target_qty: 12, produced_qty: 0, status: 'pending',
    assigned_to: null, started_at: null, completed_at: null,
    created_at: '2026-08-24T12:00:00Z', updated_at: '2026-08-24T12:00:00Z',
    itemName: 'Pistachio Milk Cake',
    recipe: {
      id: 'recipe-1', menu_item_id: 'item-1', version: 1, steps: [],
      allergens: ['nuts', 'dairy'], yield_qty: 12, yield_unit: 'slices',
    },
    ...over,
  };
}

describe('sortBakeList', () => {
  it('orders work in progress, largest pending, then completed work without mutation', () => {
    const input = [
      batch({ id: 'done', status: 'done' }),
      batch({ id: 'small', target_qty: 6 }),
      batch({ id: 'oven', status: 'in_progress' }),
      batch({ id: 'big', target_qty: 24 }),
      batch({ id: 'gone', status: 'abandoned' }),
    ];
    assert.deepEqual(sortBakeList(input).map((entry) => entry.id), ['oven', 'big', 'small', 'done', 'gone']);
    assert.equal(input[0]?.id, 'done');
  });
});

describe('bakeProgress', () => {
  it('counts finished work and excludes abandoned batches', () => {
    assert.deepEqual(bakeProgress([
      batch({ id: 'done', status: 'done' }),
      batch({ id: 'todo' }),
      batch({ id: 'gone', status: 'abandoned' }),
    ]), { done: 1, total: 2 });
  });
});

describe('recipeSteps', () => {
  it('carries valid quantities and drops malformed steps', () => {
    assert.deepEqual(
      recipeSteps([{ n: 1, text: ' Mix ', quantity: 250, unit: 'g' }, { nope: true }]),
      [{ n: 1, text: 'Mix', quantity: 250, unit: 'g' }],
    );
  });
});

describe('multiplierLabel', () => {
  it('labels doubled and partial batches, but not one recipe', () => {
    assert.equal(multiplierLabel(1), '');
    assert.equal(multiplierLabel(2), 'x2');
    assert.equal(multiplierLabel(1.5), 'x1.5');
  });
});
