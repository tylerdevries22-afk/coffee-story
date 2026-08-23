import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  bakeProgress, multiplierLabel, scaleQuantity, sortBakeList, type BakeBatch,
} from './bake-list';

function batch(over: Partial<BakeBatch> & { id: string }): BakeBatch {
  return {
    itemName: 'Pistachio Milk Cake',
    targetQty: 12,
    producedQty: 0,
    status: 'pending',
    allergens: ['nuts', 'dairy'],
    yieldQty: 12,
    yieldUnit: 'slices',
    ...over,
  };
}

describe('sortBakeList', () => {
  it('puts what is already in the oven first', () => {
    const list = sortBakeList([
      batch({ id: 'a', status: 'pending' }),
      batch({ id: 'b', status: 'in_progress' }),
      batch({ id: 'c', status: 'done' }),
    ]);
    assert.deepEqual(list.map((b) => b.id), ['b', 'a', 'c']);
  });

  it('starts the biggest pending batch soonest', () => {
    // A bigger tray needs more lead time to be out when it is wanted.
    const list = sortBakeList([
      batch({ id: 'small', targetQty: 6 }),
      batch({ id: 'big', targetQty: 24 }),
      batch({ id: 'mid', targetQty: 12 }),
    ]);
    assert.deepEqual(list.map((b) => b.id), ['big', 'mid', 'small']);
  });

  it('sinks abandoned batches below finished ones', () => {
    const list = sortBakeList([
      batch({ id: 'gone', status: 'abandoned' }),
      batch({ id: 'made', status: 'done' }),
    ]);
    assert.deepEqual(list.map((b) => b.id), ['made', 'gone']);
  });

  it('does not mutate what it was given', () => {
    const input = [batch({ id: 'a', status: 'done' }), batch({ id: 'b', status: 'pending' })];
    sortBakeList(input);
    assert.deepEqual(input.map((b) => b.id), ['a', 'b']);
  });
});

describe('bakeProgress', () => {
  it('counts finished against the day', () => {
    assert.deepEqual(
      bakeProgress([
        batch({ id: 'a', status: 'done' }),
        batch({ id: 'b', status: 'pending' }),
        batch({ id: 'c', status: 'in_progress' }),
      ]),
      { done: 1, total: 3 },
    );
  });

  it('excludes abandoned batches from both halves', () => {
    // An abandoned tray is not work still owed, and counting it would leave the
    // header stuck at "3 of 4" for the rest of the shift.
    assert.deepEqual(
      bakeProgress([batch({ id: 'a', status: 'done' }), batch({ id: 'b', status: 'abandoned' })]),
      { done: 1, total: 1 },
    );
  });
});

describe('scaleQuantity', () => {
  it('keeps the recipe figure beside the scaled one', () => {
    const scaled = scaleQuantity(250, { targetQty: 24, yieldQty: 12 });
    assert.equal(scaled.recipe, 250);
    assert.equal(scaled.batch, 500);
    assert.equal(scaled.multiplier, 2);
  });

  it('rounds to two decimals rather than implying a precision no scale has', () => {
    const scaled = scaleQuantity(100, { targetQty: 7, yieldQty: 3 });
    assert.equal(scaled.batch, 233.33);
  });

  it('falls back to the recipe figure on a nonsense yield', () => {
    const scaled = scaleQuantity(250, { targetQty: 24, yieldQty: 0 });
    assert.equal(scaled.batch, 250);
    assert.equal(scaled.multiplier, 1);
  });
});

describe('multiplierLabel', () => {
  it('says nothing when the batch is one recipe', () => {
    assert.equal(multiplierLabel(1), '');
  });

  it('labels a doubled or part batch', () => {
    assert.equal(multiplierLabel(2), 'x2');
    assert.equal(multiplierLabel(1.5), 'x1.5');
    assert.equal(multiplierLabel(0.5), 'x0.5');
  });
});
