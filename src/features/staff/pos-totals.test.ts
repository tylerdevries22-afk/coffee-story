import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  ADD_ONS,
  DISCOUNT_CODE_CENTS,
  MEMBERSHIP_CREDIT_CENTS,
  TAX_RATE,
  TIP_RATES,
  VISIT_LINE_ID,
  addCartLine,
  changeCartQty,
  registerTotals,
  removeCartLine,
  selectVisitLines,
  visitLines,
  type CartLine,
} from './pos-totals';

const visit = { serviceName: 'Deep Tissue Massage', balanceCents: 11000 };
const line = (over: Partial<CartLine> = {}): CartLine => ({
  id: 'l1', name: 'Aromatherapy', priceCents: 1500, qty: 1, ...over,
});

test('an empty ticket totals zero rather than NaN', () => {
  const totals = registerTotals({ cart: [] });
  assert.deepEqual(
    [totals.subtotalCents, totals.taxCents, totals.baseCents, totals.tipCents, totals.totalCents],
    [0, 0, 0, 0, 0],
  );
});

test('quantities multiply into the subtotal', () => {
  const totals = registerTotals({ cart: [line({ qty: 3 }), line({ id: 'l2', priceCents: 2000 })] });
  assert.equal(totals.subtotalCents, 1500 * 3 + 2000);
});

test('the two discounts stack on a ticket large enough to absorb them', () => {
  const totals = registerTotals({ cart: [line({ priceCents: 20000 })], codeApplied: true, membershipCredit: true });
  assert.equal(totals.discountCents, DISCOUNT_CODE_CENTS + MEMBERSHIP_CREDIT_CENTS);
  assert.equal(totals.taxableCents, 20000 - 4000);
});

test('a discount larger than the ticket is clamped rather than creating money', () => {
  const totals = registerTotals({ cart: [line({ priceCents: 500 })], membershipCredit: true });
  assert.equal(totals.discountCents, 500, 'the discount cannot exceed the subtotal');
  assert.equal(totals.taxableCents, 0);
  assert.equal(totals.taxCents, 0);
  assert.equal(totals.baseCents, 0);
});

test('tip rides on the pre-discount subtotal, so a studio discount does not cut it', () => {
  const withDiscount = registerTotals({ cart: [line({ priceCents: 10000 })], codeApplied: true, tipRate: TIP_RATES['20%'] });
  const without = registerTotals({ cart: [line({ priceCents: 10000 })], tipRate: TIP_RATES['20%'] });
  assert.equal(withDiscount.tipCents, without.tipCents);
  assert.equal(withDiscount.tipCents, 2000);
});

test('tip and tax round to whole cents', () => {
  // 3333 * 0.15 = 499.95 and 3333 * 0.08 = 266.64: both must land on an integer.
  const totals = registerTotals({ cart: [line({ priceCents: 3333 })], tipRate: TIP_RATES['15%'] });
  assert.equal(totals.tipCents, 500);
  assert.equal(totals.taxCents, 267);
  assert.ok(Number.isInteger(totals.totalCents));
});

test('tax follows the discount, so a discounted ticket is not overtaxed', () => {
  // The regression this file was written for. Previously tax was computed on
  // the full subtotal, so this ticket billed 880 and the customer overpaid
  // $1.20. Matches lib/booking/pos-totals.ts on the web register.
  const totals = registerTotals({ cart: [line({ priceCents: 11000 })], codeApplied: true });
  assert.equal(totals.taxableCents, 11000 - DISCOUNT_CODE_CENTS);
  assert.equal(totals.taxCents, 760);
  assert.equal(totals.baseCents, 9500 + 760);
});

test('the register agrees with the web POS, to the cent', () => {
  // lib/booking/pos-totals.ts works in dollars and rounds with
  // Math.round(v * 100) / 100. Comparing in cents rather than dollars is not
  // pedantry: 9500 / 100 * 0.08 is 7.6000000000000005 in float, which is the
  // dust the cents representation exists to avoid.
  const totals = registerTotals({ cart: [line({ priceCents: 11000 })], codeApplied: true });
  const webTaxCents = Math.round(((11000 - DISCOUNT_CODE_CENTS) / 100) * TAX_RATE * 100);
  assert.equal(totals.taxCents, webTaxCents);
  assert.equal(totals.taxCents, 760);
});

test('a card tender settles the visit balance plus tip, never the ticket total', () => {
  const cart = [...visitLines(visit), line({ id: 'addon', priceCents: 2500 })];
  const totals = registerTotals({ cart, tipRate: TIP_RATES['20%'], visitBalanceCents: visit.balanceCents });
  assert.equal(totals.cardChargeCents, visit.balanceCents + totals.tipCents);
  assert.ok(totals.cardChargeCents < totals.totalCents);
  assert.equal(totals.extrasCents, totals.totalCents - totals.cardChargeCents);
});

test('with no visit attached the card is asked for the whole ticket and nothing is extra', () => {
  const totals = registerTotals({ cart: [line()], tipRate: TIP_RATES['10%'] });
  assert.equal(totals.cardChargeCents, totals.totalCents);
  assert.equal(totals.extrasCents, 0);
});

test('extras never go negative when the balance exceeds the ticket', () => {
  const totals = registerTotals({ cart: [line({ priceCents: 100 })], visitBalanceCents: 50000 });
  assert.equal(totals.extrasCents, 0);
});

test('visitLines yields nothing without an appointment', () => {
  assert.deepEqual(visitLines(undefined), []);
});

test('selecting a visit swaps the visit line and keeps the add-ons', () => {
  const cart = [...visitLines(visit), line({ id: 'addon' })];
  const next = selectVisitLines(cart, { serviceName: 'Swedish', balanceCents: 9000 });
  assert.equal(next.filter((l) => l.id === VISIT_LINE_ID).length, 1);
  assert.equal(next[0].priceCents, 9000);
  assert.ok(next.some((l) => l.id === 'addon'));
});

test('adding an identical line merges instead of repeating it', () => {
  const once = addCartLine([], ADD_ONS[0].name, ADD_ONS[0].priceCents);
  const twice = addCartLine(once, ADD_ONS[0].name, ADD_ONS[0].priceCents);
  assert.equal(twice.length, 1);
  assert.equal(twice[0].qty, 2);
});

test('the same name at a different price is a separate line', () => {
  const cart = addCartLine(addCartLine([], 'Aromatherapy', 1500), 'Aromatherapy', 2000);
  assert.equal(cart.length, 2);
});

test('decrementing to zero drops the line', () => {
  const cart = addCartLine([], 'Hot stones', 2500);
  assert.deepEqual(changeCartQty(cart, cart[0].id, -1), []);
});

test('changing a quantity leaves other lines untouched', () => {
  const cart = [line({ id: 'a' }), line({ id: 'b', name: 'CBD balm' })];
  const next = changeCartQty(cart, 'a', 2);
  assert.equal(next.find((l) => l.id === 'a')?.qty, 3);
  assert.deepEqual(next.find((l) => l.id === 'b'), cart[1]);
});

test('cart mutations never mutate the input array', () => {
  const cart = [line()];
  const snapshot = structuredClone(cart);
  addCartLine(cart, 'Hot stones', 2500);
  changeCartQty(cart, 'l1', 1);
  removeCartLine(cart, 'l1');
  selectVisitLines(cart, visit);
  assert.deepEqual(cart, snapshot);
});

/**
 * CHARACTERIZATION -- generated line ids collide.
 *
 * `addCartLine` derives an id from the cart's current length, so removing a
 * line and adding a different item at the same price reuses an id that is
 * already taken. `changeCartQty` then moves both lines at once. Pinned rather
 * than fixed here so the checkout split cannot change it silently.
 */
test('CHARACTERIZATION: length-derived ids can collide after a removal', () => {
  let cart = addCartLine(addCartLine([], 'A', 100), 'B', 100);
  assert.deepEqual(cart.map((l) => l.id), ['A-100-0', 'B-100-1']);
  cart = removeCartLine(cart, 'A-100-0');
  cart = addCartLine(cart, 'C', 100);
  assert.equal(cart[1].id, 'C-100-1');
  assert.equal(cart[0].id, 'B-100-1', 'two lines now share an id');
});
