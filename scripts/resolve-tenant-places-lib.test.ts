import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applyResolvedPlaces,
  resolveLocations,
  tenantBrandPath,
  type PlaceLocation,
} from './resolve-tenant-places-lib';

const place = (placeId: string) => ({
  placeId,
  name: placeId,
  formattedAddress: null,
  location: null,
  rating: null,
  userRatingCount: null,
  websiteUri: null,
  phone: null,
  weekdayDescriptions: [],
  photoNames: [],
  types: ['lodging'],
});

test('tenantBrandPath keeps a valid tenant under the tenant root', () => {
  assert.equal(
    tenantBrandPath('/repo', 'summit-ridge-hotels'),
    '/repo/tenants/summit-ridge-hotels/brand.json',
  );
});

test('tenantBrandPath rejects traversal and non-canonical tenant names', () => {
  for (const slug of ['../../outside', '../tenant', '/absolute', 'Uppercase', 'two--dashes']) {
    assert.throws(() => tenantBrandPath('/repo', slug), /Invalid tenant slug/);
  }
});

test('resolved Places map back by branch position when display names repeat', async () => {
  const locations: PlaceLocation[] = [
    { name: 'Downtown', placeQuery: 'Downtown, Denver' },
    { name: 'Downtown', placeQuery: 'Downtown, Boulder' },
  ];
  const outcomes = await resolveLocations(
    locations,
    async (query) => place(query.endsWith('Denver') ? 'denver-id' : 'boulder-id'),
    false,
  );

  assert.equal(applyResolvedPlaces(locations, outcomes), 2);
  assert.deepEqual(locations.map(({ googlePlaceId }) => googlePlaceId), ['denver-id', 'boulder-id']);
});
