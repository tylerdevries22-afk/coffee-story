import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { DeviceInstallationSummary, DeviceWallPolicy } from '@platform/device-wall';

import { deviceConnectionFlow } from './device-connection-flow';

const policy: DeviceWallPolicy = {
  schemaVersion: 1, moduleId: 'device-wall', enabled: true, rollout: 'registration_only',
  appTargets: ['operator', 'pickup_queue', 'kiosk_pos'], formFactors: ['phone', 'tablet', 'tv'],
  limits: { maxConcurrentStreams: 4, maxViewersPerDevice: 1 },
  connection: { heartbeatIntervalSeconds: 30, degradedAfterSeconds: 75, offlineAfterSeconds: 180 },
  retention: { archiveAfterDays: 30, auditDays: 365 },
  visuals: { phoneModel: 'iphone15-pro-max', finish: 'natural-titanium', tabletStyle: 'studio', tvStyle: 'studio' },
};

function installation(overrides: Partial<DeviceInstallationSummary> = {}): DeviceInstallationSummary {
  return {
    id: 'installation', brandId: 'brand', locationId: 'location', installedBy: null,
    label: 'Runner phone', formFactor: 'phone', appTarget: 'operator', platform: 'ios',
    appVersion: '1.0.0', runtimeVersion: 'exposdk-54.0.0',
    capabilities: ['heartbeat', 'diagnostics', 'screen_capture', 'webrtc', 'turn'],
    lastSeenAt: '2026-09-02T00:00:00.000Z', archivedAt: null, connectionState: 'online',
    ...overrides,
  };
}

describe('device connection flow', () => {
  it('uses safe checks until the tenant streaming rollout is enabled', () => {
    const flow = deviceConnectionFlow(installation(), policy, false);
    assert.equal(flow.action, 'diagnose');
    assert.match(flow.description, /staged/);
  });

  it('requests owner-authorized consent only from a stream-capable device', () => {
    const flow = deviceConnectionFlow(installation(), { ...policy, rollout: 'owner_beta' }, true);
    assert.equal(flow.action, 'request_stream');
    assert.equal(flow.streamEligible, true);
  });

  it('does not send a connection request to provisioning or archived devices', () => {
    assert.equal(deviceConnectionFlow(installation({ connectionState: 'provisioning' }), policy, false).action, 'none');
    assert.equal(deviceConnectionFlow(installation({ connectionState: 'archived' }), policy, true).action, 'none');
  });

  it('falls back to diagnostics when screen-sharing capabilities are incomplete', () => {
    const flow = deviceConnectionFlow(installation({ capabilities: ['heartbeat'] }), { ...policy, rollout: 'full' }, true);
    assert.equal(flow.action, 'diagnose');
    assert.equal(flow.streamEligible, false);
  });

  it('requires a current heartbeat before a secure connection can be requested', () => {
    const flow = deviceConnectionFlow(installation({ connectionState: 'offline' }), { ...policy, rollout: 'full' }, true);
    assert.equal(flow.action, 'diagnose');
    assert.match(flow.description, /current heartbeat/);
  });
});
