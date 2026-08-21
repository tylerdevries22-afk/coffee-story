import assert from 'node:assert/strict';
import test from 'node:test';

import {
  dispatchAddressLine,
  fulfillmentDetail,
  OFFICE_LOCATIONS,
  validateDispatchAddress,
  type DispatchAddress,
} from './fulfillment';

const address: DispatchAddress = {
  street: '1240 Maple Avenue',
  unit: 'Unit 4',
  city: 'Greenwood Village',
  state: 'co',
  postalCode: '80111',
  instructions: 'Use the east entrance.',
};

test('accepts a complete dispatch address', () => {
  assert.equal(validateDispatchAddress(address), null);
});

test('rejects incomplete or malformed dispatch addresses', () => {
  assert.match(validateDispatchAddress({ ...address, street: '' }) ?? '', /street/i);
  assert.match(validateDispatchAddress({ ...address, state: 'Colorado' }) ?? '', /two-letter/i);
  assert.match(validateDispatchAddress({ ...address, postalCode: '801' }) ?? '', /ZIP/i);
});

test('formats optional units and normalizes the state', () => {
  assert.equal(
    dispatchAddressLine(address),
    '1240 Maple Avenue, Unit 4, Greenwood Village, CO 80111',
  );
  assert.equal(
    dispatchAddressLine({ ...address, unit: '' }),
    '1240 Maple Avenue, Greenwood Village, CO 80111',
  );
});

test('describes office fulfillment from the selected office', () => {
  assert.equal(
    fulfillmentDetail({ mode: 'office', office: OFFICE_LOCATIONS[0] }),
    '5650 Greenwood Plaza Blvd, Suite 225-C, Greenwood Village, CO 80111',
  );
});
