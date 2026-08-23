import assert from 'node:assert/strict';
import test from 'node:test';

import { currentBusiness } from '@/data/business';

import {
  dispatchAddressLine,
  fulfillmentDetail,
  officeLocations,
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
  // Against the tenant, not a literal street: pinning Coffee Story's address
  // here is what let the pickup card ship to every other brand's guests.
  const business = currentBusiness();
  assert.equal(
    fulfillmentDetail({ mode: 'office', office: officeLocations()[0]! }),
    `${business.street}, ${business.cityLine}`,
  );
});

test('the pickup location is the tenant it was built for', () => {
  const office = officeLocations()[0]!;
  const business = currentBusiness();
  assert.equal(office.name, business.name);
  assert.equal(office.address, business.street);
  assert.equal(office.cityLine, business.cityLine);
});
