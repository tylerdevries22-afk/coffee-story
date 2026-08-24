import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { EMPTY_CART, addOrderLine, buildOrderLine } from '@platform/domain';

import { EmptyBagError, toPlaceOrderRequest } from './order-request';

function cartWith(...lines: Parameters<typeof buildOrderLine>[0][]) {
  return lines.reduce((cart, input) => addOrderLine(cart, buildOrderLine(input)), EMPTY_CART);
}

const LATTE = {
  itemId: 'tiramisu-latte', name: 'Tiramisu Latte', sizeSlug: 'tiramisu-latte-16',
  sizeLabel: '16 oz', basePriceCents: 700, groups: [], selection: {}, quantity: 2,
};

describe('toPlaceOrderRequest', () => {
  it('sends slugs and a quantity, and never sends money', () => {
    // The server reprices every line from menu_items; a client that sent prices
    // would be inviting them to be trusted.
    const request = toPlaceOrderRequest({
      cart: cartWith(LATTE), locationId: 'loc-1', tenderType: 'pay_at_pickup',
    });
    assert.deepEqual(request.lines, [{
      itemSlug: 'tiramisu-latte', sizeSlug: 'tiramisu-latte-16', quantity: 2, modifierSlugs: [],
    }]);
    assert.equal(JSON.stringify(request).includes('700'), false, 'no price may reach the wire');
    assert.equal(request.fulfillmentType, 'pickup');
  });

  it('refuses an empty bag here rather than letting the guest see a 400', () => {
    assert.throws(
      () => toPlaceOrderRequest({ cart: EMPTY_CART, locationId: 'loc-1', tenderType: 'pay_at_pickup' }),
      EmptyBagError,
    );
  });

  it('omits the guest label entirely when there is none', () => {
    const request = toPlaceOrderRequest({
      cart: cartWith(LATTE), locationId: 'loc-1', tenderType: 'pay_at_pickup', guestLabel: null,
    });
    assert.equal('guestLabel' in request, false, 'an absent name must be absent, not empty');
  });

  it('carries a name when one was given', () => {
    const request = toPlaceOrderRequest({
      cart: cartWith(LATTE), locationId: 'loc-1', tenderType: 'pay_at_pickup', guestLabel: 'Sara D.',
    });
    assert.equal(request.guestLabel, 'Sara D.');
  });

  it('never sends a negative or fractional tip', () => {
    for (const [given, expected] of [[-500, 0], [2.7, 2], [undefined, 0]] as const) {
      const request = toPlaceOrderRequest({
        cart: cartWith(LATTE), locationId: 'loc-1', tenderType: 'pay_at_pickup', tipCents: given,
      });
      assert.equal(request.tipCents, expected, String(given));
    }
  });

  it('merges two taps of the same drink into one line, as the bag does', () => {
    const request = toPlaceOrderRequest({
      cart: cartWith(LATTE, LATTE), locationId: 'loc-1', tenderType: 'pay_at_pickup',
    });
    assert.equal(request.lines.length, 1);
    assert.equal(request.lines[0]?.quantity, 4);
  });
});
