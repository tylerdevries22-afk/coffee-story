import assert from 'node:assert/strict';
import test from 'node:test';

import {
  deliveryAddressLine,
  fulfillmentDetail,
  PICKUP_LOCATIONS,
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
  assert.equal(
    fulfillmentDetail({ mode: 'pickup', location: PICKUP_LOCATIONS[0] }),
    '2222 S Havana St Unit A1, Aurora, CO 80014',
  );
});
