import assert from 'node:assert/strict';
import test from 'node:test';

import {
  adminNavigationGroupsForRole,
  isNativeAdminDestination,
  searchAdminWorkspace,
} from './admin-navigation';

const CLIENTS = [
  { id: 'client-1', fullName: 'Alex Rivera', email: 'alex@example.com', phone: '303-555-0181', completedVisits: 4 },
  { id: 'client-2', fullName: 'Jamie Lee', email: 'jamie@example.com', phone: null, completedVisits: 2 },
] as const;

test('admin More groups preserve the web information architecture', () => {
  assert.deepEqual(
    adminNavigationGroupsForRole('admin').map((group) => group.title),
    ['Operations', 'People', 'Marketing', 'Configuration'],
  );
});

test('staff More excludes owner-only groups and destinations', () => {
  const groups = adminNavigationGroupsForRole('staff');
  assert.deepEqual(groups.map((group) => group.title), ['Operations', 'Marketing']);
  assert.deepEqual(
    groups.flatMap((group) => group.destinations.map((destination) => destination.path)),
    ['/admin/dashboard', '/admin/calendar', '/admin/clients', '/admin/pos', '/admin/services', '/admin/rewards', '/admin/reviews'],
  );
});

test('workspace search combines permitted destinations and matching clients', () => {
  assert.deepEqual(
    searchAdminWorkspace('alex', 'staff', CLIENTS).map((result) => result.title),
    ['Alex Rivera'],
  );
  assert.deepEqual(
    searchAdminWorkspace('settings', 'staff', CLIENTS),
    [],
  );
  assert.equal(searchAdminWorkspace('settings', 'admin', CLIENTS)[0]?.path, '/admin/settings');
});

test('native destination guard includes the proposal and rejects unknown paths', () => {
  assert.equal(isNativeAdminDestination('/proposal'), true);
  assert.equal(isNativeAdminDestination('/admin/settings'), true);
  assert.equal(isNativeAdminDestination('/admin/unknown'), false);
});
