import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_ADMIN_SETTINGS,
  isAdminSettingWritableInLive,
  isAdminSettingsTabWritableInLive,
  mergeServerStaffSettings,
  serverStaffSettings,
  validateAdminSettings,
  withBusinessIdentity,
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

test('Business Info shows the signed-in brand, not the bundled demo shop', () => {
  // The tab is read-only in live mode, but it was still rendering Coffee
  // Story's name, mailbox and street to whichever tenant's staff signed in.
  const applied = withBusinessIdentity(DEFAULT_ADMIN_SETTINGS, {
    name: 'Demo Roastery',
    email: 'hello@demoroastery.example',
    phone: '(303) 555-0143',
    street: '100 Main St',
    cityLine: 'Denver, CO 80202',
  });
  assert.equal(applied.businessName, 'Demo Roastery');
  assert.equal(applied.businessEmail, 'hello@demoroastery.example');
  assert.equal(applied.businessPhone, '(303) 555-0143');
  assert.equal(applied.businessAddress, '100 Main St, Denver, CO 80202');
  // Everything that is a real setting is left alone.
  assert.equal(applied.leadTimeMinutes, DEFAULT_ADMIN_SETTINGS.leadTimeMinutes);
  assert.deepEqual(applied.availability, DEFAULT_ADMIN_SETTINGS.availability);
});

test('a brand with no posted address gets no address, not somebody else\'s', () => {
  const applied = withBusinessIdentity(DEFAULT_ADMIN_SETTINGS, {
    name: 'Demo Roastery', email: '', phone: '', street: '', cityLine: '',
  });
  assert.equal(applied.businessAddress, '');
  // And it does not lock them out of Settings: the identity fields are not
  // editable in live mode, so they cannot block saving an availability change.
  assert.equal(validateAdminSettings(applied, true), null);
  assert.equal(validateAdminSettings(applied), 'Enter a valid business email.');
});
