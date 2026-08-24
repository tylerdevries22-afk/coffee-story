import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  captureCredentialOperation,
  isCredentialOperationCurrent,
  isExpired,
  needsRefresh,
  nextCredentialGeneration,
  parseStoredDeviceToken,
} from './device-credential';

const TOKEN = {
  token: 'token-value',
  expiresAt: '2030-01-01T00:00:00.000Z',
  deviceId: 'device-1',
  role: 'kiosk',
  brandId: 'brand-1',
  locationId: 'location-1',
  label: 'Lobby',
  tenantSlug: 'coffee-story',
};

describe('parseStoredDeviceToken', () => {
  it('accepts a complete device token', () => {
    assert.deepEqual(parseStoredDeviceToken(TOKEN), TOKEN);
  });

  it('rejects missing, malformed, and unknown-role records', () => {
    assert.equal(parseStoredDeviceToken(null), null);
    assert.equal(parseStoredDeviceToken({ ...TOKEN, locationId: undefined }), null);
    assert.equal(parseStoredDeviceToken({ ...TOKEN, expiresAt: 'later' }), null);
    assert.equal(parseStoredDeviceToken({ ...TOKEN, role: 'owner' }), null);
    assert.equal(parseStoredDeviceToken({ ...TOKEN, tenantSlug: undefined }), null);
  });
});

describe('device token expiry', () => {
  const expiry = Date.parse(TOKEN.expiresAt);

  it('refreshes in the final hour but distinguishes an actually expired token', () => {
    assert.equal(needsRefresh(TOKEN, expiry - 30 * 60 * 1000), true);
    assert.equal(isExpired(TOKEN, expiry - 30 * 60 * 1000), false);
    assert.equal(isExpired(TOKEN, expiry), true);
  });
});

describe('credential operation generation', () => {
  it('accepts an operation only while its original bearer remains current', () => {
    const operation = captureCredentialOperation(4, 'device-token');

    assert.equal(isCredentialOperationCurrent(operation, 4, 'device-token'), true);
    assert.equal(isCredentialOperationCurrent(operation, 4, 'replacement-token'), false);
  });

  it('rejects a refresh that resolves after the device is unpaired', () => {
    const operation = captureCredentialOperation(9, 'device-token');
    const unpairedGeneration = nextCredentialGeneration(operation.generation);

    assert.equal(isCredentialOperationCurrent(operation, unpairedGeneration, null), false);
  });
});
