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
  STAFF_CHECKOUT_HREF,
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

test('the order board leads the bar, and checkout stays off it', () => {
  assert.deepEqual(STAFF_TAB_ORDER, ['orders', 'today', 'calendar', 'quick-actions', 'clients', 'more']);
  // Six triggers: fine on the iPad this app targets first; a phone-sized
  // UITabBar folds the sixth into the system More overflow, which is the
  // accepted cost of keeping the board as the first tab.
  assert.equal(STAFF_TAB_ORDER.length, 6);
});

test('primary admin paths route to their matching staff tab, not a detail page', () => {
  const href = staffDestinationHref('/admin/calendar');
  assert.equal(href, staffTabHref('calendar'));
  assert.equal(staffTabFromPathname(href), 'calendar');
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

test('checkout is a pushed page under More, reachable by its own href and by /admin/pos', () => {
  assert.equal(staffTabHref('checkout'), STAFF_CHECKOUT_HREF);
  assert.equal(staffDestinationHref('/admin/pos'), STAFF_CHECKOUT_HREF);
  assert.equal(staffTabFromPathname(STAFF_CHECKOUT_HREF), 'checkout');
  // The one detail path that doesn't reconstruct byte-for-byte from its own
  // segments (the route is named `checkout`, not `admin/pos`) -- pinned
  // explicitly since the round-trip property test below excludes it.
  assert.equal(staffDetailPathFromPathname(STAFF_CHECKOUT_HREF), '/admin/pos');
});
