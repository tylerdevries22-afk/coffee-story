import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  EMPTY_CART,
  MAX_LINE_QUANTITY,
  MAX_ORDER_NOTE_LENGTH,
  addOrderLine,
  addableQuantity,
  buildOrderLine,
  changeOrderLineQuantity,
  clearOrderCart,
  isCartEmpty,
  optionSummary,
  orderItemCount,
  orderLineTotalCents,
  orderSubtotalCents,
  removeOrderLine,
  setOrderNote,
  type OrderCart,
} from './cart';
import { optionGroupsFor } from './menu-options';

const latteGroups = optionGroupsFor('latte', 'coffee');

function latte(selection: Record<string, string[]>, quantity = 1) {
  return buildOrderLine({
    itemId: 'latte',
    name: 'Latte',
    sizeSlug: 'latte-16',
    sizeLabel: '16 oz',
    basePriceCents: 500,
    groups: latteGroups,
    selection,
    quantity,
  });
}

describe('buildOrderLine', () => {
  it('prices a plain drink at its list price', () => {
    const line = latte({ serve: ['serve-hot'] });
    assert.equal(line.unitPriceCents, 500);
    assert.equal(line.basePriceCents, 500);
    assert.equal(line.quantity, 1);
  });

  it('adds every paid customization to the unit price', () => {
    const line = latte({ serve: ['serve-hot'], milk: ['milk-oat'], extras: ['extra-extra-shot'] });
    assert.equal(line.unitPriceCents, 500 + 75 + 150);
  });

  it('summarises the size first, then the choices, pricing only the paid ones', () => {
    const line = latte({ serve: ['serve-iced'], ice: ['ice-regular'], milk: ['milk-oat'] });
    assert.equal(line.optionSummary, '16 oz · Iced · Regular Ice · Oat Milk (+$0.75)');
  });

  it('leaves a hidden choice out of both the price and the summary', () => {
    const line = latte({ serve: ['serve-hot'], ice: ['ice-extra'] });
    assert.equal(line.optionSummary, '16 oz · Hot');
    assert.equal(line.unitPriceCents, 500);
  });

  it('sorts the option ids so an identical drink is identical', () => {
    const forwards = latte({ serve: ['serve-hot'], extras: ['extra-extra-shot', 'extra-boba-pearls'] });
    const backwards = latte({ extras: ['extra-boba-pearls', 'extra-extra-shot'], serve: ['serve-hot'] });
    assert.deepEqual(forwards.optionIds, backwards.optionIds);
    assert.equal(forwards.id, backwards.id);
  });

  it('gives two sizes of the same drink different line ids', () => {
    const small = latte({ serve: ['serve-hot'] });
    const large = buildOrderLine({
      itemId: 'latte',
      name: 'Latte',
      sizeSlug: 'latte-20',
      sizeLabel: '20 oz',
      basePriceCents: 600,
      groups: latteGroups,
      selection: { serve: ['serve-hot'] },
    });
    assert.notEqual(small.id, large.id);
  });

  it('clamps a nonsense quantity rather than storing it', () => {
    assert.equal(latte({ serve: ['serve-hot'] }, 0).quantity, 1);
    assert.equal(latte({ serve: ['serve-hot'] }, -4).quantity, 1);
    assert.equal(latte({ serve: ['serve-hot'] }, 999).quantity, MAX_LINE_QUANTITY);
    assert.equal(latte({ serve: ['serve-hot'] }, Number.NaN).quantity, 1);
  });

  it('never carries a negative base price', () => {
    const line = buildOrderLine({
      itemId: 'free', name: 'Free', sizeSlug: 'free', sizeLabel: 'Each',
      basePriceCents: -900, groups: [], selection: {},
    });
    assert.equal(line.basePriceCents, 0);
    assert.equal(line.unitPriceCents, 0);
  });
});

describe('optionSummary', () => {
  it('is just the size when nothing is customised', () => {
    assert.equal(optionSummary('12 oz', latteGroups, {}), '12 oz');
  });
});

describe('addOrderLine', () => {
  it('merges an identical configuration instead of stacking a second row', () => {
    const line = latte({ serve: ['serve-hot'] });
    const cart = addOrderLine(addOrderLine(EMPTY_CART, line), line);
    assert.equal(cart.lines.length, 1);
    assert.equal(cart.lines[0].quantity, 2);
  });

  it('keeps a differently configured drink as its own row', () => {
    const cart = addOrderLine(
      addOrderLine(EMPTY_CART, latte({ serve: ['serve-hot'] })),
      latte({ serve: ['serve-hot'], milk: ['milk-oat'] }),
    );
    assert.equal(cart.lines.length, 2);
  });

  it('caps a merged line rather than letting it climb past the maximum', () => {
    const line = latte({ serve: ['serve-hot'] }, MAX_LINE_QUANTITY);
    const cart = addOrderLine(addOrderLine(EMPTY_CART, line), line);
    assert.equal(cart.lines[0].quantity, MAX_LINE_QUANTITY);
  });

  it('reports how many of an add the bag can actually take', () => {
    // The cap is silent inside addOrderLine, so a caller that does not ask
    // first would quote a guest five more drinks and add none of them.
    const full = addOrderLine(EMPTY_CART, latte({ serve: ['serve-hot'] }, MAX_LINE_QUANTITY));
    assert.equal(addableQuantity(full, latte({ serve: ['serve-hot'] }, 5)), 0);

    const nearlyFull = addOrderLine(EMPTY_CART, latte({ serve: ['serve-hot'] }, MAX_LINE_QUANTITY - 2));
    assert.equal(addableQuantity(nearlyFull, latte({ serve: ['serve-hot'] }, 5)), 2);
  });

  it('takes a full add when there is room, and when the line is new', () => {
    assert.equal(addableQuantity(EMPTY_CART, latte({ serve: ['serve-hot'] }, 3)), 3);
    const other = addOrderLine(EMPTY_CART, latte({ serve: ['serve-hot'], milk: ['milk-oat'] }, MAX_LINE_QUANTITY));
    assert.equal(addableQuantity(other, latte({ serve: ['serve-hot'] }, 4)), 4);
  });

  it('never reports more room than was asked for', () => {
    assert.equal(addableQuantity(EMPTY_CART, latte({ serve: ['serve-hot'] }, 1)), 1);
  });

  it('leaves the original cart untouched', () => {
    const cart = addOrderLine(EMPTY_CART, latte({ serve: ['serve-hot'] }));
    assert.equal(EMPTY_CART.lines.length, 0);
    assert.equal(cart.lines.length, 1);
  });
});

describe('quantity and removal', () => {
  const seeded: OrderCart = addOrderLine(EMPTY_CART, latte({ serve: ['serve-hot'] }, 2));
  const lineId = seeded.lines[0].id;

  it('adds and subtracts', () => {
    assert.equal(changeOrderLineQuantity(seeded, lineId, 1).lines[0].quantity, 3);
    assert.equal(changeOrderLineQuantity(seeded, lineId, -1).lines[0].quantity, 1);
  });

  it('drops the line at zero rather than keeping an empty row', () => {
    assert.equal(changeOrderLineQuantity(seeded, lineId, -2).lines.length, 0);
    assert.equal(changeOrderLineQuantity(seeded, lineId, -50).lines.length, 0);
  });

  it('ignores an id that is not in the bag', () => {
    assert.deepEqual(changeOrderLineQuantity(seeded, 'nope', 1).lines, seeded.lines);
    assert.deepEqual(removeOrderLine(seeded, 'nope').lines, seeded.lines);
  });

  it('removes a line outright', () => {
    assert.equal(removeOrderLine(seeded, lineId).lines.length, 0);
  });
});

describe('totals and counts', () => {
  it('multiplies quantity into the line total and the subtotal', () => {
    const cart = addOrderLine(
      addOrderLine(EMPTY_CART, latte({ serve: ['serve-hot'] }, 3)),
      latte({ serve: ['serve-hot'], milk: ['milk-oat'] }, 2),
    );
    assert.equal(orderLineTotalCents(cart.lines[0]), 1500);
    assert.equal(orderLineTotalCents(cart.lines[1]), (500 + 75) * 2);
    assert.equal(orderSubtotalCents(cart), 1500 + 1150);
    assert.equal(orderItemCount(cart), 5);
  });

  it('totals an empty bag at zero rather than NaN', () => {
    assert.equal(orderSubtotalCents(EMPTY_CART), 0);
    assert.equal(orderItemCount(EMPTY_CART), 0);
    assert.equal(isCartEmpty(EMPTY_CART), true);
  });
});

describe('the order note', () => {
  it('is capped at the length the field advertises', () => {
    const cart = setOrderNote(EMPTY_CART, 'x'.repeat(MAX_ORDER_NOTE_LENGTH + 40));
    assert.equal(cart.note.length, MAX_ORDER_NOTE_LENGTH);
  });

  it('survives a quantity change', () => {
    const withNote = setOrderNote(addOrderLine(EMPTY_CART, latte({ serve: ['serve-hot'] })), 'For Amina');
    assert.equal(changeOrderLineQuantity(withNote, withNote.lines[0].id, 1).note, 'For Amina');
  });

  it('is cleared along with the bag', () => {
    const cleared = clearOrderCart();
    assert.equal(cleared.note, '');
    assert.equal(cleared.lines.length, 0);
  });
});
