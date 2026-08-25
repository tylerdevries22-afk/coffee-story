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
  assert.deepEqual(STAFF_TAB_ORDER, ['orders', 'prep', 'calendar', 'training', 'more']);
  assert.equal(STAFF_TAB_ORDER[0], 'orders');
});

test('Crew admin destinations live under More instead of occupying a tab', () => {
  const href = staffDestinationHref('/admin/dashboard');
  assert.equal(href, '/staff/more/admin/dashboard');
  assert.equal(staffTabFromPathname(href), 'more');
  assert.equal(staffDetailPathFromPathname(href), '/admin/dashboard');
});

test('the pushed Crew route keeps More highlighted', () => {
  assert.equal(staffTabFromPathname('/staff/crew'), 'more');
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


test('the custom bar shows every staff tab', () => {
  const source = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '..', 'components', 'bottom-nav.tsx'),
    'utf8',
  );
  const block = /const STAFF_ITEMS[\s\S]*?\n\];/.exec(source);
  assert.ok(block, 'STAFF_ITEMS is not declared in bottom-nav.tsx');
  const keys = [...block[0].matchAll(/key: '([a-z-]+)'/g)].map((m) => m[1]);
  assert.deepEqual(keys, [...STAFF_TAB_ORDER]);
});
