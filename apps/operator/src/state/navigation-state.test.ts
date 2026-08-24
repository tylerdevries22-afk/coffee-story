import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

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
  assert.deepEqual(STAFF_TAB_ORDER, ['orders', 'prep', 'crew', 'more']);
  // Four triggers, still inside the five a UITabBar shows before it collapses
  // the rest into a system More overflow -- worth watching, because a fifth
  // would push Profile into that overflow. The board is first because that is
  // the tab a mounted device should wake on.
  assert.equal(STAFF_TAB_ORDER[0], 'orders');
});

test('primary admin paths route to their matching staff tab, not a detail page', () => {
  const href = staffDestinationHref('/admin/dashboard');
  assert.equal(href, staffTabHref('crew'));
  assert.equal(staffTabFromPathname(href), 'crew');
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


test('the web bar shows every staff tab the native bar does', () => {
  // The web bar writes its own list because each row carries an icon the
  // native UITabBar declares at its trigger instead. That duplication once
  // shipped a staff bar with no Orders tab at all (docs/BUILD-REPORT.md), so
  // the two lists are pinned to each other here.
  const source = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '..', 'components', 'bottom-nav.tsx'),
    'utf8',
  );
  const block = /const STAFF_ITEMS[\s\S]*?\n\];/.exec(source);
  assert.ok(block, 'STAFF_ITEMS is not declared in bottom-nav.tsx');
  const keys = [...block[0].matchAll(/key: '([a-z-]+)'/g)].map((m) => m[1]);
  assert.deepEqual(keys, [...STAFF_TAB_ORDER]);
});
