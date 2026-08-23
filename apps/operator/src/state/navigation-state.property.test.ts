import assert from 'node:assert/strict';
import test from 'node:test';

import { forAll } from '@/test-support/property';

import {
  clientMoreHref,
  clientMoreViewFromPathname,
  clientTabFromPathname,
  clientTabHref,
  CLIENT_TAB_ORDER,
  isMoreView,
  staffDestinationHref,
  staffDetailPathFromPathname,
  staffTabFromPathname,
  staffTabHref,
  STAFF_TAB_ORDER,
  type ClientTab,
  type MoreView,
  type StaffTab,
} from './navigation-state';

const MORE_VIEWS: readonly MoreView[] = [
  'menu', 'services', 'orders', 'profile', 'preferences', 'messages', 'membership',
  'payments', 'gift-balance', 'location', 'resources', 'faq', 'care-policy',
  'privacy', 'admin',
];
const STAFF_TABS: readonly StaffTab[] = [...STAFF_TAB_ORDER];
const ADMIN_PATHS_ON_A_TAB = ['/admin/dashboard'];
const ADMIN_DETAIL_PATHS = ['/admin/reviews', '/admin/staff', '/admin/talent-acquisition', '/proposal'];

function pick<T>(items: readonly T[], random: () => number): T {
  const item = items[Math.floor(random() * items.length)];
  if (item === undefined) throw new Error('empty pick pool');
  return item;
}

test('every client tab href reports the same tab back', () => {
  forAll(0xC1E17, 500, (random) => pick(CLIENT_TAB_ORDER, random), (tab: ClientTab) => {
    const href = clientTabHref(tab);
    assert.equal(clientTabFromPathname(href), tab);
  });
});

test('every client More href reports the same tab and the same view back', () => {
  forAll(0xC1E18, 500, (random) => pick(MORE_VIEWS, random), (view: MoreView) => {
    const href = clientMoreHref(view);
    assert.equal(clientTabFromPathname(href), 'more');
    assert.equal(clientMoreViewFromPathname(href), view);
    assert.ok(isMoreView(clientMoreViewFromPathname(href)));
  });
});

test('every staff tab href reports the same tab back', () => {
  forAll(0x57AFF, 500, (random) => pick(STAFF_TABS, random), (tab: StaffTab) => {
    const href = staffTabHref(tab);
    assert.equal(staffTabFromPathname(href), tab);
    // A tab is never also a detail page -- its href is a fixed route, not a
    // captured admin path.
    assert.equal(staffDetailPathFromPathname(href), null);
  });
});

test('an admin path that maps to a tab never becomes a detail page', () => {
  forAll(0x57B00, 500, (random) => pick(ADMIN_PATHS_ON_A_TAB, random), (path: string) => {
    const href = staffDestinationHref(path);
    assert.notEqual(staffTabFromPathname(href), 'more');
    assert.equal(staffDetailPathFromPathname(href), path === '/admin/pos' ? '/admin/pos' : null);
  });
});

test('every other admin path pushes a detail page under More and round-trips', () => {
  forAll(0x57B01, 500, (random) => pick(ADMIN_DETAIL_PATHS, random), (path: string) => {
    const href = staffDestinationHref(path);
    assert.equal(staffTabFromPathname(href), 'more');
    assert.equal(staffDetailPathFromPathname(href), path);
  });
});
