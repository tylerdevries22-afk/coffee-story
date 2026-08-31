import assert from 'node:assert/strict';
import test from 'node:test';

import { locationCreationContinuation } from './location-onboarding';

test('a home-organization location may continue into Square consent', () => {
  assert.deepEqual(locationCreationContinuation({
    locationId: 'location-1',
    homeOrganizationId: 'brand-1',
    selectedOrganizationId: 'brand-1',
    connectSquare: true,
  }), {
    kind: 'connect',
    href: '/api/square/connect?location_id=location-1',
  });
});

test('a selected organization reports that Square consent was deferred', () => {
  assert.deepEqual(locationCreationContinuation({
    locationId: 'location-2',
    homeOrganizationId: 'brand-1',
    selectedOrganizationId: 'brand-2',
    connectSquare: true,
  }), { kind: 'created', notice: 'square_deferred' });
});

test('opting out finishes without a Square continuation', () => {
  assert.deepEqual(locationCreationContinuation({
    locationId: 'location-3',
    homeOrganizationId: 'brand-1',
    selectedOrganizationId: 'brand-1',
    connectSquare: false,
  }), { kind: 'created', notice: '1' });
});
