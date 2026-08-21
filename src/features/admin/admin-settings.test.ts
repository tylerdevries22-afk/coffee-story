import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_ADMIN_SETTINGS,
  isAdminSettingWritableInLive,
  isAdminSettingsTabWritableInLive,
  mergeServerStaffSettings,
  serverStaffSettings,
  validateAdminSettings,
} from './admin-settings';

test('accepts the complete default administration settings', () => {
  assert.equal(validateAdminSettings(DEFAULT_ADMIN_SETTINGS), null);
});

test('rejects invalid booking and business settings', () => {
  assert.equal(
    validateAdminSettings({ ...DEFAULT_ADMIN_SETTINGS, leadTimeMinutes: -1 }),
    'Lead time must be between 0 and 10,080 minutes.',
  );
  assert.equal(
    validateAdminSettings({ ...DEFAULT_ADMIN_SETTINGS, businessEmail: 'not-an-email' }),
    'Enter a valid business email.',
  );
});

test('server settings round-trip without demo-only fields', () => {
  const server = serverStaffSettings(DEFAULT_ADMIN_SETTINGS);
  assert.equal('businessName' in server, false);
  const merged = mergeServerStaffSettings(
    { ...DEFAULT_ADMIN_SETTINGS, businessName: 'Local studio name' },
    { ...server, leadTimeMinutes: 180 },
  );
  assert.equal(merged.businessName, 'Local studio name');
  assert.equal(merged.leadTimeMinutes, 180);
});

test('live settings expose only fields the server contract persists', () => {
  assert.equal(isAdminSettingsTabWritableInLive('Availability'), true);
  assert.equal(isAdminSettingsTabWritableInLive('Messages'), true);
  assert.equal(isAdminSettingsTabWritableInLive('Forms'), false);
  assert.equal(isAdminSettingsTabWritableInLive('Business Info'), false);
  assert.equal(isAdminSettingWritableInLive('reviewRequestEnabled'), true);
  assert.equal(isAdminSettingWritableInLive('confirmationsEnabled'), false);
  assert.equal(isAdminSettingWritableInLive('intakeRequired'), false);
  assert.equal(isAdminSettingWritableInLive('businessName'), false);
});
