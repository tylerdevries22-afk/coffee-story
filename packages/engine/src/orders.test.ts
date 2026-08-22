import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildSquareLines } from './orders';

describe('buildSquareLines', () => {
  it('folds options into the name and stringifies quantity, integer cents', () => {
    assert.deepEqual(buildSquareLines([
      { itemId: 'x', name: 'Oat Latte', quantity: 2, unitPriceCents: 625, options: ['16 oz', 'Iced'] },
      { itemId: 'y', name: 'Croissant', quantity: 1, unitPriceCents: 450, options: [] },
    ]), [
      { name: 'Oat Latte (16 oz, Iced)', quantity: '2', base_price_money: { amount: 625, currency: 'USD' } },
      { name: 'Croissant', quantity: '1', base_price_money: { amount: 450, currency: 'USD' } },
    ]);
  });
});
