import {
  DEVICE_APP_TARGETS, DEVICE_FORM_FACTORS, type DeviceAppTarget, type DeviceCapability,
  type DeviceFormFactor, type DeviceInstallationSummary, type DeviceWallPolicy, type DeviceWallRollout,
} from './types';

const ROLLOUTS: readonly DeviceWallRollout[] = [
  'disabled', 'registration_only', 'owner_beta', 'full',
];

export class DeviceWallPolicyError extends Error {
  constructor(readonly field: string, message: string) {
    super(message);
    this.name = 'DeviceWallPolicyError';
  }
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new DeviceWallPolicyError(field, `${field} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function integer(value: unknown, field: string, minimum: number, maximum: number): number {
  if (!Number.isInteger(value) || typeof value !== 'number' || value < minimum || value > maximum) {
    throw new DeviceWallPolicyError(field, `${field} must be an integer from ${minimum} to ${maximum}.`);
  }
  return value;
}

function allowedList<T extends string>(
  value: unknown, field: string, allowed: readonly T[],
): readonly T[] {
  if (!Array.isArray(value) || value.length === 0 || value.some((item) => !allowed.includes(item as T))) {
    throw new DeviceWallPolicyError(field, `${field} contains an unsupported value.`);
  }
  const unique = [...new Set(value as T[])];
  if (unique.length !== value.length) throw new DeviceWallPolicyError(field, `${field} must be unique.`);
  return unique;
}

export function parseDeviceWallPolicy(value: unknown): DeviceWallPolicy {
  const source = record(value, 'deviceWall');
  if (source.schemaVersion !== 1) throw new DeviceWallPolicyError('schemaVersion', 'Only schemaVersion 1 is supported.');
  if (source.moduleId !== 'device-wall') throw new DeviceWallPolicyError('moduleId', 'moduleId must be device-wall.');
  if (typeof source.enabled !== 'boolean') throw new DeviceWallPolicyError('enabled', 'enabled must be boolean.');
  if (!ROLLOUTS.includes(source.rollout as DeviceWallRollout)) {
    throw new DeviceWallPolicyError('rollout', 'rollout is not supported.');
  }
  const limits = record(source.limits, 'limits');
  const connection = record(source.connection, 'connection');
  const retention = record(source.retention, 'retention');
  const visuals = record(source.visuals, 'visuals');
  const heartbeat = integer(connection.heartbeatIntervalSeconds, 'connection.heartbeatIntervalSeconds', 10, 120);
  const degraded = integer(connection.degradedAfterSeconds, 'connection.degradedAfterSeconds', 30, 600);
  const offline = integer(connection.offlineAfterSeconds, 'connection.offlineAfterSeconds', 60, 900);
  if (heartbeat >= degraded || degraded >= offline) {
    throw new DeviceWallPolicyError('connection', 'Connection thresholds must increase from heartbeat to offline.');
  }
  const archive = integer(retention.archiveAfterDays, 'retention.archiveAfterDays', 1, 365);
  const audit = integer(retention.auditDays, 'retention.auditDays', archive, 2_555);
  if (visuals.phoneModel !== 'iphone15-pro-max' || visuals.tabletStyle !== 'studio' || visuals.tvStyle !== 'studio') {
    throw new DeviceWallPolicyError('visuals', 'The configured device twin style is not supported.');
  }
  if (visuals.finish !== 'natural-titanium' && visuals.finish !== 'graphite') {
    throw new DeviceWallPolicyError('visuals.finish', 'The device finish is not supported.');
  }
  return {
    schemaVersion: 1,
    moduleId: 'device-wall',
    enabled: source.enabled,
    rollout: source.rollout as DeviceWallRollout,
    appTargets: allowedList<DeviceAppTarget>(source.appTargets, 'appTargets', DEVICE_APP_TARGETS),
    formFactors: allowedList<DeviceFormFactor>(source.formFactors, 'formFactors', DEVICE_FORM_FACTORS),
    limits: {
      maxConcurrentStreams: integer(limits.maxConcurrentStreams, 'limits.maxConcurrentStreams', 1, 8),
      maxViewersPerDevice: integer(limits.maxViewersPerDevice, 'limits.maxViewersPerDevice', 1, 1) as 1,
    },
    connection: { heartbeatIntervalSeconds: heartbeat, degradedAfterSeconds: degraded, offlineAfterSeconds: offline },
    retention: { archiveAfterDays: archive, auditDays: audit },
    visuals: {
      phoneModel: 'iphone15-pro-max', finish: visuals.finish,
      tabletStyle: 'studio', tvStyle: 'studio',
    },
  };
}

/** Screen sharing is opt-in and requires every transport capability. */
export function canRequestScreenView(
  installation: Pick<DeviceInstallationSummary, 'capabilities'>,
): boolean {
  const capabilities = new Set(installation.capabilities);
  const required: readonly DeviceCapability[] = ['screen_capture', 'webrtc', 'turn'];
  return required.every((capability) => capabilities.has(capability));
}
