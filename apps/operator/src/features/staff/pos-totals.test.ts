import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  ADD_ONS,
  DISCOUNT_CODE_CENTS,
  MEMBERSHIP_CREDIT_CENTS,
  taxRateFor,
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
import { orderTotals , combinedTaxRate, taxCentsFor } from '@platform/domain';

/**
 * A fixture, not the platform's rates. The register takes its tenant's list as
 * an argument now; these numbers match Coffee Story's only because the
 * assertions below are pinned to them.
 */
const FOUR_AUTHORITIES = [
  { id: 'state', label: 'State Sales Tax', rate: 0.029 },
  { id: 'city', label: 'City Sales Tax', rate: 0.0375 },
  { id: 'rtd', label: 'Transit District Tax', rate: 0.01 },
  { id: 'county', label: 'County Tax', rate: 0.0025 },
];

/**
 * Every case below is about discounts, tips and rounding -- not about which
 * jurisdiction the shop is in -- so the tenant's list is supplied once here
 * rather than restated in twenty call sites.
 */
const totalsFor = (
  input: Omit<Parameters<typeof registerTotals>[0], 'jurisdictions'>,
) => registerTotals({ ...input, jurisdictions: FOUR_AUTHORITIES });


const order = { serviceName: 'Deep Tissue Massage', balanceCents: 11000 };
const line = (over: Partial<CartLine> = {}): CartLine => ({
  id: 'l1', name: 'Aromatherapy', priceCents: 1500, qty: 1, ...over,
});

test('an empty ticket totals zero rather than NaN', () => {
  const totals = totalsFor({ cart: [] });
  assert.deepEqual(
    [totals.subtotalCents, totals.taxCents, totals.baseCents, totals.tipCents, totals.totalCents],
    [0, 0, 0, 0, 0],
  );
});

test('quantities multiply into the subtotal', () => {
  const totals = totalsFor({ cart: [line({ qty: 3 }), line({ id: 'l2', priceCents: 2000 })] });
  assert.equal(totals.subtotalCents, 1500 * 3 + 2000);
});

test('the two discounts stack on a ticket large enough to absorb them', () => {
  const totals = totalsFor({ cart: [line({ priceCents: 20000 })], codeApplied: true, membershipCredit: true });
  assert.equal(totals.discountCents, DISCOUNT_CODE_CENTS + MEMBERSHIP_CREDIT_CENTS);
  assert.equal(totals.taxableCents, 20000 - 4000);
});

test('a discount larger than the ticket is clamped rather than creating money', () => {
  const totals = totalsFor({ cart: [line({ priceCents: 500 })], membershipCredit: true });
  assert.equal(totals.discountCents, 500, 'the discount cannot exceed the subtotal');
  assert.equal(totals.taxableCents, 0);
  assert.equal(totals.taxCents, 0);
  assert.equal(totals.baseCents, 0);
});

test('tip rides on the pre-discount subtotal, so a studio discount does not cut it', () => {
  const withDiscount = totalsFor({ cart: [line({ priceCents: 10000 })], codeApplied: true, tipRate: TIP_RATES['20%'] });
  const without = totalsFor({ cart: [line({ priceCents: 10000 })], tipRate: TIP_RATES['20%'] });
  assert.equal(withDiscount.tipCents, without.tipCents);
  assert.equal(withDiscount.tipCents, 2000);
});

test('tip and tax round to whole cents', () => {
  // 3333 * 0.15 = 499.95, and the four Aurora rows on 3333 are 96.657, 124.9875,
  // 33.33 and 8.3325: every one must land on an integer.
  const totals = totalsFor({ cart: [line({ priceCents: 3333 })], tipRate: TIP_RATES['15%'] });
  assert.equal(totals.tipCents, 500);
  assert.equal(totals.taxCents, taxCentsFor(3333, FOUR_AUTHORITIES));
  assert.equal(totals.taxCents, 97 + 125 + 33 + 8);
  assert.ok(Number.isInteger(totals.totalCents));
});

test('tax follows the discount, so a discounted ticket is not overtaxed', () => {
  // The regression this file was written for. Previously tax was computed on
  // the full subtotal, so the customer overpaid on every discounted ticket.
  const totals = totalsFor({ cart: [line({ priceCents: 11000 })], codeApplied: true });
  assert.equal(totals.taxableCents, 11000 - DISCOUNT_CODE_CENTS);
  assert.equal(totals.taxCents, taxCentsFor(9500, FOUR_AUTHORITIES));
  assert.equal(totals.baseCents, 9500 + totals.taxCents);
});

test('the register charges the same tax the client checkout prints', () => {
  // The register used to apply a flat 8% while features/order/totals.ts
  // itemised Aurora's four authorities at 7.90%, so the same order cost more
  // rung up at the bar than ordered from the app. Both now read
  // features/tax.ts. NOTE: the web register at lib/booking/pos-totals.ts is
  // still on the flat rate and has to follow -- see PRODUCTION_SETUP.md.
  const totals = totalsFor({ cart: [line({ priceCents: 11000 })], codeApplied: true });
  const fromCheckout = orderTotals({ subtotalCents: 9500, jurisdictions: FOUR_AUTHORITIES });
  assert.equal(totals.taxCents, fromCheckout.taxCents);
  assert.equal(taxRateFor(FOUR_AUTHORITIES), combinedTaxRate(FOUR_AUTHORITIES));
});

test('a card tender settles the order balance plus tip, never the ticket total', () => {
  const cart = [...visitLines(order), line({ id: 'addon', priceCents: 2500 })];
  const totals = totalsFor({ cart, tipRate: TIP_RATES['20%'], visitBalanceCents: order.balanceCents });
  assert.equal(totals.cardChargeCents, order.balanceCents + totals.tipCents);
  assert.ok(totals.cardChargeCents < totals.totalCents);
  assert.equal(totals.extrasCents, totals.totalCents - totals.cardChargeCents);
});

test('with no order attached the card is asked for the whole ticket and nothing is extra', () => {
  const totals = totalsFor({ cart: [line()], tipRate: TIP_RATES['10%'] });
  assert.equal(totals.cardChargeCents, totals.totalCents);
  assert.equal(totals.extrasCents, 0);
});

test('extras never go negative when the balance exceeds the ticket', () => {
  const totals = totalsFor({ cart: [line({ priceCents: 100 })], visitBalanceCents: 50000 });
  assert.equal(totals.extrasCents, 0);
});

test('visitLines yields nothing without an order', () => {
  assert.deepEqual(visitLines(undefined), []);
});

test('selecting a order swaps the order line and keeps the add-ons', () => {
  const cart = [...visitLines(order), line({ id: 'addon' })];
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
  selectVisitLines(cart, order);
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
