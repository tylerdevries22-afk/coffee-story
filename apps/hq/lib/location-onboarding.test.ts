import assert from 'node:assert/strict';
import test from 'node:test';

import { locationCreationContinuation } from './location-onboarding';

test('a home-organization location pairs before continuing into Square consent', () => {
  assert.deepEqual(locationCreationContinuation({
    locationId: 'location-1',
    homeOrganizationId: 'brand-1',
    selectedOrganizationId: 'brand-1',
    connectSquare: true,
  }), {
    kind: 'onboard',
    href: '/locations/new?created=location-1&square=1',
    squareHref: '/api/square/connect?location_id=location-1',
    squareDeferred: false,
  });
});

test('a selected organization reports that Square consent was deferred', () => {
  assert.deepEqual(locationCreationContinuation({
    locationId: 'location-2',
    homeOrganizationId: 'brand-1',
    selectedOrganizationId: 'brand-2',
    connectSquare: true,
  }), {
    kind: 'onboard',
    href: '/locations/new?created=location-2&square=deferred',
    squareHref: null,
    squareDeferred: true,
  });
});

test('opting out finishes without a Square continuation', () => {
  assert.deepEqual(locationCreationContinuation({
    locationId: 'location-3',
    homeOrganizationId: 'brand-1',
    selectedOrganizationId: 'brand-1',
    connectSquare: false,
  }), {
    kind: 'onboard',
    href: '/locations/new?created=location-3',
    squareHref: null,
    squareDeferred: false,
  });
});
