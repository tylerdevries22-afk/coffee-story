import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  canAccessInstallation, canRequestScreenView, connectionStateAt, diagnosticPlan, mayCreateEnrollment,
  normalizeDeviceLabel, pairedDeviceRole, parseDeviceRegistration, parseDeviceWallPolicy,
  parseDeviceEnrollment,
  parseDeviceWallLayout,
  shouldArchiveInstallation, type DeviceInstallationSummary,
} from './index';

const policy = parseDeviceWallPolicy({
  schemaVersion: 1, moduleId: 'device-wall', enabled: true, rollout: 'owner_beta',
  appTargets: ['operator', 'pickup_queue', 'kiosk_pos'], formFactors: ['phone', 'tablet', 'tv'],
  limits: { maxConcurrentStreams: 4, maxViewersPerDevice: 1 },
  connection: { heartbeatIntervalSeconds: 30, degradedAfterSeconds: 75, offlineAfterSeconds: 180 },
  retention: { archiveAfterDays: 30, auditDays: 365 },
  visuals: { phoneModel: 'iphone15-pro-max', finish: 'natural-titanium', tabletStyle: 'studio', tvStyle: 'studio' },
});

const installation: DeviceInstallationSummary = {
  id: 'i', brandId: 'brand', locationId: 'location', installedBy: 'staff', label: 'Prep tablet',
  formFactor: 'tablet', appTarget: 'operator', platform: 'ios', appVersion: '1.0.0',
  runtimeVersion: 'exposdk-54', capabilities: ['heartbeat'], lastSeenAt: null,
  archivedAt: null, connectionState: 'provisioning',
};

describe('device wall policy', () => {
  it('accepts the production defaults', () => assert.equal(policy.limits.maxConcurrentStreams, 4));
  it('rejects unsafe connection ordering', () => assert.throws(() => parseDeviceWallPolicy({
    ...policy, connection: { heartbeatIntervalSeconds: 90, degradedAfterSeconds: 75, offlineAfterSeconds: 180 },
  }), /thresholds/));
  it('rejects unknown module versions', () => assert.throws(() => parseDeviceWallPolicy({ ...policy, schemaVersion: 2 }), /schemaVersion/));
});

describe('connection state', () => {
  const now = Date.parse('2026-09-01T12:00:00.000Z');
  const at = (seconds: number) => new Date(now - seconds * 1_000).toISOString();
  it('moves through every state at the configured boundaries', () => {
    assert.equal(connectionStateAt({ lastSeenAt: null, archivedAt: null }, policy, now), 'provisioning');
    assert.equal(connectionStateAt({ lastSeenAt: at(75), archivedAt: null }, policy, now), 'online');
    assert.equal(connectionStateAt({ lastSeenAt: at(76), archivedAt: null }, policy, now), 'degraded');
    assert.equal(connectionStateAt({ lastSeenAt: at(181), archivedAt: null }, policy, now), 'offline');
    assert.equal(connectionStateAt({ lastSeenAt: at(1), archivedAt: at(0) }, policy, now), 'archived');
  });
  it('archives at the configured inactivity limit', () => {
    assert.equal(shouldArchiveInstallation(null, new Date(now - 30 * 86_400_000).toISOString(), 30, now), true);
    assert.equal(shouldArchiveInstallation(at(30), at(30), 30, now), false);
  });
});

describe('screen view capability', () => {
  it('requires capture, WebRTC, and TURN before a stream can be requested', () => {
    assert.equal(canRequestScreenView({ capabilities: ['screen_capture', 'webrtc', 'turn'] }), true);
    assert.equal(canRequestScreenView({ capabilities: ['screen_capture', 'webrtc'] }), false);
  });
});

describe('access and enrollment', () => {
  it('keeps managers status-only and staff scoped to their installation', () => {
    const manager = { userId: 'manager', brandId: 'brand', role: 'location_manager' as const, locationIds: ['location'] };
    const staff = { userId: 'staff', brandId: 'brand', role: 'staff' as const, locationIds: ['location'] };
    assert.equal(canAccessInstallation(manager, installation, 'read_status'), true);
    assert.equal(canAccessInstallation(manager, installation, 'diagnose'), false);
    assert.equal(canAccessInstallation(staff, installation, 'share_own'), true);
    assert.equal(mayCreateEnrollment('location_manager'), false);
    assert.equal(mayCreateEnrollment('brand_owner'), true);
  });
  it('validates an authenticated operator registration', () => {
    const parsed = parseDeviceRegistration({
      installationId: '28dd1216-96ca-4d79-a97f-d33051a578d3',
      locationId: '6b91e60d-0872-47cf-b27e-9a9daeb47b88', label: '  Prep   tablet  ',
      formFactor: 'tablet', appTarget: 'operator', platform: 'ios', appVersion: '1.0.0',
      runtimeVersion: 'exposdk-54.0.0', capabilities: ['heartbeat', 'heartbeat'], publicKey: null,
    });
    assert.equal(parsed.label, 'Prep tablet');
    assert.deepEqual(parsed.capabilities, ['heartbeat']);
    assert.equal(pairedDeviceRole('operator'), 'prep');
    assert.equal(pairedDeviceRole('pickup_queue'), 'display');
    assert.equal(pairedDeviceRole('kiosk_pos'), 'kiosk');
  });
  it('bounds labels and registration capabilities', () => {
    assert.equal(normalizeDeviceLabel('  Front   counter  '), 'Front counter');
    assert.throws(() => normalizeDeviceLabel(' '.repeat(8)), /label/);
    assert.throws(() => normalizeDeviceLabel('x'.repeat(61)), /label/);
    assert.throws(() => parseDeviceRegistration({
      installationId: '28dd1216-96ca-4d79-a97f-d33051a578d3',
      locationId: '6b91e60d-0872-47cf-b27e-9a9daeb47b88', label: 'Register',
      formFactor: 'tablet', appTarget: 'operator', platform: 'ios', appVersion: '1.0.0',
      runtimeVersion: 'exposdk-54.0.0', capabilities: ['remote_control'], publicKey: null,
    }), /capabilities/);
  });
  it('accepts a bounded hardware-backed public identity', () => {
    const parsed = parseDeviceRegistration({
      installationId: '28dd1216-96ca-4d79-a97f-d33051a578d3',
      locationId: '6b91e60d-0872-47cf-b27e-9a9daeb47b88', label: 'Order station',
      formFactor: 'tablet', appTarget: 'operator', platform: 'android', appVersion: '1.0.0',
      runtimeVersion: 'exposdk-54.0.0', capabilities: ['heartbeat'],
      publicKey: JSON.stringify({ kty: 'RSA', alg: 'RS256', use: 'sig', spki: 'a'.repeat(420) }),
    });
    assert.match(parsed.publicKey ?? '', /RS256/);
  });
  it('validates a location-bound enrollment request', () => {
    const parsed = parseDeviceEnrollment({
      locationId: '6b91e60d-0872-47cf-b27e-9a9daeb47b88', label: ' Lobby TV ',
      formFactor: 'tv', appTarget: 'pickup_queue',
    });
    assert.equal(parsed.label, 'Lobby TV');
    assert.equal(parsed.brandId, null);
  });
  it('never schedules unavailable or unsafe diagnostics', () => {
    assert.deepEqual(diagnosticPlan(['heartbeat']).map((item) => item.key), [
      'heartbeat', 'reconnect', 'authentication', 'runtime',
    ]);
  });
  it('normalizes a unique personal layout', () => {
    const layout = parseDeviceWallLayout([{
      installationId: '28dd1216-96ca-4d79-a97f-d33051a578d3', x: 1.234,
      y: 2, width: 240, orientation: 'portrait',
    }]);
    assert.equal(layout[0]?.x, 1.23);
    assert.throws(() => parseDeviceWallLayout([...layout, ...layout]), /unique UUID/);
  });
});
