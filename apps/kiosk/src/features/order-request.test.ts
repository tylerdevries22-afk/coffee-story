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

  it('carries tenant-authored modifier choices onto the server-priced request', () => {
    const groups = [{
      id: 'temperature', name: 'Temperature', select: 'single' as const,
      required: true, maxChoices: 1,
      choices: [{ id: 'warm', name: 'Warm', priceDeltaCents: 75 }],
    }];
    const request = toPlaceOrderRequest({
      cart: cartWith({ ...LATTE, groups, selection: { temperature: ['warm'] } }),
      locationId: 'loc-1',
      tenderType: 'pay_at_pickup',
    });
    assert.deepEqual(request.lines[0]?.modifierSlugs, ['warm']);
  });

  it('omits the client-only size synthesized for a live no-size item', () => {
    const request = toPlaceOrderRequest({
      cart: cartWith({
        ...LATTE,
        itemId: 'cortado',
        name: 'Cortado',
        sizeSlug: 'each',
        sizeSlugIsSynthetic: true,
        sizeLabel: 'Each',
      }),
      locationId: 'loc-1',
      tenderType: 'pay_at_pickup',
    });
    assert.deepEqual(request.lines[0], {
      itemSlug: 'cortado', quantity: 2, modifierSlugs: [],
    });
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

  it('carries the approved ceiling without treating it as a price authority', () => {
    const request = toPlaceOrderRequest({
      cart: cartWith(LATTE),
      locationId: 'loc-1',
      tenderType: 'pay_at_pickup',
      maximumTotalCents: 1_512.9,
    });
    assert.equal(request.maximumTotalCents, 1_512);
  });

  it('merges two taps of the same drink into one line, as the bag does', () => {
    const request = toPlaceOrderRequest({
      cart: cartWith(LATTE, LATTE), locationId: 'loc-1', tenderType: 'pay_at_pickup',
    });
    assert.equal(request.lines.length, 1);
    assert.equal(request.lines[0]?.quantity, 4);
  });

  it('carries an existing per-line note without changing the pricing payload', () => {
    const line = { ...buildOrderLine(LATTE), note: 'Pack contents: 2 × Matcha, 4 × Ube' };
    const request = toPlaceOrderRequest({
      cart: addOrderLine(EMPTY_CART, line), locationId: 'loc-1', tenderType: 'pay_at_pickup',
    });
    assert.equal(request.lines[0]?.note, line.note);
    assert.equal('unitPriceCents' in (request.lines[0] ?? {}), false);
  });

  it('sends pack contents as server-validatable slugs and quantities', () => {
    const line = {
      ...buildOrderLine({ ...LATTE, itemId: 'brew-box-4', name: 'Brew Box' }),
      packContents: [
        { itemSlug: 'v60-ethiopia', name: 'Ethiopia', quantity: 3 },
        { itemSlug: 'v60-kenya', name: 'Kenya', quantity: 1 },
      ],
    };
    const request = toPlaceOrderRequest({
      cart: addOrderLine(EMPTY_CART, line), locationId: 'loc-1', tenderType: 'pay_at_pickup',
    });
    assert.deepEqual(request.lines[0]?.packContents, [
      { itemSlug: 'v60-ethiopia', quantity: 3 },
      { itemSlug: 'v60-kenya', quantity: 1 },
    ]);
    assert.equal(JSON.stringify(request.lines[0]).includes('Ethiopia'), false);
  });
});
