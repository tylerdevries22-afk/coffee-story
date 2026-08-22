import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ADMIN_DESTINATIONS,
  CLIENT_WEB_DESTINATIONS,
  adminDestinationsForRole,
} from './portal-navigation';

test('client navigation preserves every web portal destination', () => {
  assert.deepEqual(CLIENT_WEB_DESTINATIONS.map((destination) => destination.path), [
    '/account',
    '/account/appointments',
    '/account/book',
    '/account/gift-cards',
    '/account/gift',
    '/account/intake',
    '/account/memberships',
    '/account/messages',
    '/account/more',
    '/account/profile',
    '/account/rewards',
  ]);
});

test('admin navigation preserves every web administration destination', () => {
  const adminPaths = adminDestinationsForRole('admin').map((destination) => destination.path);
  assert.equal(adminPaths.length, ADMIN_DESTINATIONS.length);
  assert.ok(adminPaths.includes('/admin/talent-acquisition'));
  assert.ok(adminPaths.includes('/admin/reviews'));
  assert.ok(adminPaths.includes('/admin/marketing'));
  assert.ok(adminPaths.includes('/admin/analytics'));
  assert.ok(adminPaths.includes('/admin/ads'));
});

test('staff navigation excludes owner-only administration pages', () => {
  const staffPaths = adminDestinationsForRole('staff').map((destination) => destination.path);
  assert.deepEqual(staffPaths, [
    '/admin/dashboard',
    '/admin/calendar',
    '/admin/clients',
    '/admin/pos',
    '/admin/services',
    '/admin/rewards',
    '/admin/reviews',
  ]);
});
