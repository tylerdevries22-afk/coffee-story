import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { EMPTY_CART, type OrderCart } from '@platform/domain';

import { cartButtonLabel, checkoutEntryStep } from './cart-drawer';

const CART = {
  lines: [
    {
      id: 'latte-1', itemId: 'latte', name: 'Latte', sizeSlug: 'latte-12',
      sizeLabel: '12 oz', basePriceCents: 600, unitPriceCents: 600,
      quantity: 2, optionIds: [], optionSummary: '',
    },
    {
      id: 'tea-1', itemId: 'tea', name: 'Tea', sizeSlug: 'tea-12',
      sizeLabel: '12 oz', basePriceCents: 400, unitPriceCents: 400,
      quantity: 1, optionIds: [], optionSummary: '',
    },
  ],
  note: '',
} satisfies OrderCart;

const FLOW = {
  tip: { enabled: true, presetsCents: [100, 200] },
};

describe('cart drawer policy', () => {
  it('gives the black cart control one complete accessible label', () => {
    assert.equal(cartButtonLabel(EMPTY_CART, 0), 'Cart, 0 items, $0');
    assert.equal(cartButtonLabel(CART, 1600), 'Cart, 3 items, $16');
  });

  it('starts at tip only when the tenant has a usable tip choice', () => {
    assert.equal(checkoutEntryStep(FLOW), 'tip');
    assert.equal(checkoutEntryStep({ ...FLOW, tip: { enabled: false, presetsCents: [100] } }), 'pay');
    assert.equal(checkoutEntryStep({ ...FLOW, tip: { enabled: true, presetsCents: [] } }), 'pay');
  });
});
