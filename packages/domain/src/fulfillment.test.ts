import assert from 'node:assert/strict';
import test from 'node:test';

import coffeeStory from '../../../tenants/coffee-story/brand.json';
import {
  deliveryAddressLine,
  emptyDeliveryAddress,
  fulfillmentDetail,
  resolvePickupLocations,
  validateDeliveryAddress,
  type DeliveryAddress,
} from './fulfillment';

const address: DeliveryAddress = {
  street: '1240 Maple Avenue',
  unit: 'Unit 4',
  city: 'Greenwood Village',
  state: 'co',
  postalCode: '80111',
  instructions: 'Use the east entrance.',
};

test('accepts a complete delivery address', () => {
  assert.equal(validateDeliveryAddress(address), null);
});

test('rejects incomplete or malformed delivery addresses', () => {
  assert.match(validateDeliveryAddress({ ...address, street: '' }) ?? '', /street/i);
  assert.match(validateDeliveryAddress({ ...address, state: 'Colorado' }) ?? '', /two-letter/i);
  assert.match(validateDeliveryAddress({ ...address, postalCode: '801' }) ?? '', /ZIP/i);
});

test('formats optional units and normalizes the state', () => {
  assert.equal(
    deliveryAddressLine(address),
    '1240 Maple Avenue, Unit 4, Greenwood Village, CO 80111',
  );
  assert.equal(
    deliveryAddressLine({ ...address, unit: '' }),
    '1240 Maple Avenue, Greenwood Village, CO 80111',
  );
});

test('describes pickup fulfillment from the selected location', () => {
  const location = resolvePickupLocations(coffeeStory)[0];
  assert.ok(location, 'there must be at least one pickup location');
  assert.equal(
    fulfillmentDetail({ mode: 'pickup', location }),
    '2222 S Havana St Unit A1, Aurora, CO 80014',
  );
});

test('reads the tenant it was handed, and nobody else', () => {
  const [location] = resolvePickupLocations({
    identity: { name: 'Riverbend Roasters' },
    location: { address: { street: '4 Mill Lane', city: 'Ely', region: 'MN', postal: '55731' } },
  });
  assert.deepEqual(location, {
    id: 'riverbend-roasters',
    name: 'Riverbend Roasters',
    address: '4 Mill Lane',
    cityLine: 'Ely, MN 55731',
    note: '',
  });
});

test('lists every shop once multi-location is on', () => {
  const locations = resolvePickupLocations({
    identity: { name: 'Riverbend Roasters' },
    locations: [
      { id: 'mill', name: 'Riverbend — Mill Lane', address: { street: '4 Mill Lane', city: 'Ely', region: 'MN', postal: '55731' } },
      { name: 'Riverbend — Depot', address: { street: '90 Depot St', city: 'Ely', region: 'MN', postal: '55731' }, note: 'Free parking' },
    ],
  });
  assert.deepEqual(locations.map((entry) => entry.id), ['mill', 'riverbend-depot']);
  assert.equal(locations[1]?.note, 'Free parking');
});

test('drops a shop with nowhere to walk to', () => {
  // A card the guest can tap but not find is worse than no card: the order is
  // placed against an address the shop never gave.
  assert.deepEqual(resolvePickupLocations({ location: { name: 'Nowhere' } }), []);
  assert.deepEqual(resolvePickupLocations(null), []);
  assert.deepEqual(resolvePickupLocations({ location: 'nonsense' }), []);
});

test('pre-fills only the state, and only when it is one', () => {
  assert.equal(emptyDeliveryAddress(coffeeStory).state, 'CO');
  assert.equal(emptyDeliveryAddress({ location: { address: { region: 'Colorado' } } }).state, '');
  assert.equal(emptyDeliveryAddress(null).street, '');
});
