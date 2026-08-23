import assert from 'node:assert/strict';
import test from 'node:test';

import {
  clientMoreHref,
  clientMoreViewFromPathname,
  clientTabFromPathname,
  CLIENT_TAB_LABELS,
  CLIENT_TAB_ORDER,
  staffDestinationHref,
  staffDetailPathFromPathname,
  staffTabFromPathname,
  staffTabHref,
  STAFF_TAB_ORDER,
} from './navigation-state';

test('client navigation keeps Order as the persistent center destination', () => {
  assert.deepEqual(CLIENT_TAB_ORDER, ['home', 'gift', 'book', 'rewards', 'more']);
  assert.equal(CLIENT_TAB_ORDER.indexOf('book'), 2);
  assert.equal(CLIENT_TAB_LABELS.book, 'Order');
});

test('the client More href always resolves back to the menu view', () => {
  assert.equal(clientMoreHref('menu'), '/client/more');
  assert.equal(clientMoreViewFromPathname('/client/more'), 'menu');
});

test('a client More destination round-trips through its href', () => {
  const href = clientMoreHref('profile');
  assert.equal(href, '/client/more/profile');
  assert.equal(clientMoreViewFromPathname(href), 'profile');
  assert.equal(clientTabFromPathname(href), 'more');
});

test('an unrecognised More segment falls back to the menu rather than throwing', () => {
  assert.equal(clientMoreViewFromPathname('/client/more/not-a-real-view'), 'menu');
});

test('the order board leads the bar', () => {
  assert.deepEqual(STAFF_TAB_ORDER, ['orders', 'today', 'more']);
  // Three triggers, well inside the five a UITabBar shows before it collapses
  // the rest into a system More overflow. The board is first because that is
  // the tab a mounted device should wake on.
  assert.equal(STAFF_TAB_ORDER[0], 'orders');
});

test('primary admin paths route to their matching staff tab, not a detail page', () => {
  const href = staffDestinationHref('/admin/dashboard');
  assert.equal(href, staffTabHref('today'));
  assert.equal(staffTabFromPathname(href), 'today');
  assert.equal(staffDetailPathFromPathname(href), null);
});

test('secondary admin paths push a native More detail page', () => {
  const href = staffDestinationHref('/admin/talent-acquisition');
  assert.equal(href, '/staff/more/admin/talent-acquisition');
  assert.equal(staffTabFromPathname(href), 'more');
  assert.equal(staffDetailPathFromPathname(href), '/admin/talent-acquisition');
});

test('the Website Proposal opens as a native More detail page', () => {
  const href = staffDestinationHref('/proposal');
  assert.equal(href, '/staff/more/proposal');
  assert.equal(staffDetailPathFromPathname(href), '/proposal');
});

