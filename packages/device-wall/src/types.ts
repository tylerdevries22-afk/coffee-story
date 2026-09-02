export const DEVICE_FORM_FACTORS = ['phone', 'tablet', 'tv'] as const;
export type DeviceFormFactor = typeof DEVICE_FORM_FACTORS[number];

export const DEVICE_APP_TARGETS = ['operator', 'pickup_queue', 'kiosk_pos'] as const;
export type DeviceAppTarget = typeof DEVICE_APP_TARGETS[number];

export const DEVICE_PLATFORMS = ['ios', 'android', 'web'] as const;
export type DevicePlatform = typeof DEVICE_PLATFORMS[number];

export const DEVICE_CONNECTION_STATES = [
  'provisioning', 'online', 'degraded', 'offline', 'archived',
] as const;
export type DeviceConnectionState = typeof DEVICE_CONNECTION_STATES[number];

export const DEVICE_CAPABILITIES = [
  'heartbeat', 'diagnostics', 'screen_capture', 'webrtc', 'turn',
] as const;
export type DeviceCapability = typeof DEVICE_CAPABILITIES[number];

export type DeviceWallRollout = 'disabled' | 'registration_only' | 'owner_beta' | 'full';

export type DeviceWallPolicy = {
  readonly schemaVersion: 1;
  readonly moduleId: 'device-wall';
  readonly enabled: boolean;
  readonly rollout: DeviceWallRollout;
  readonly appTargets: readonly DeviceAppTarget[];
  readonly formFactors: readonly DeviceFormFactor[];
  readonly limits: {
    readonly maxConcurrentStreams: number;
    readonly maxViewersPerDevice: 1;
  };
  readonly connection: {
    readonly heartbeatIntervalSeconds: number;
    readonly degradedAfterSeconds: number;
    readonly offlineAfterSeconds: number;
  };
  readonly retention: {
    readonly archiveAfterDays: number;
    readonly auditDays: number;
  };
  readonly visuals: {
    readonly phoneModel: 'iphone15-pro-max';
    readonly finish: 'natural-titanium' | 'graphite';
    readonly tabletStyle: 'studio';
    readonly tvStyle: 'studio';
  };
};

export type DeviceInstallationSummary = {
  readonly id: string;
  readonly brandId: string;
  readonly locationId: string;
  readonly installedBy: string | null;
  readonly label: string;
  readonly formFactor: DeviceFormFactor;
  readonly appTarget: DeviceAppTarget;
  readonly platform: DevicePlatform;
  readonly appVersion: string;
  readonly runtimeVersion: string;
  readonly capabilities: readonly DeviceCapability[];
  readonly lastSeenAt: string | null;
  readonly archivedAt: string | null;
  readonly connectionState: DeviceConnectionState;
};

export type DiagnosticResult = {
  readonly key: DiagnosticKey;
  readonly status: 'pass' | 'warning' | 'fail' | 'not_available';
  readonly durationMs: number | null;
  readonly safeMessage: string;
};

export type DiagnosticKey =
  | 'heartbeat' | 'reconnect' | 'authentication' | 'runtime'
  | 'capture_permission' | 'signaling' | 'peer_connection' | 'turn';

export type StreamSession = {
  readonly id: string;
  readonly installationId: string;
  readonly viewerId: string;
  readonly state: 'requested' | 'consent_required' | 'connecting' | 'live' | 'ended';
  readonly createdAt: string;
  readonly expiresAt: string;
};

export type DeviceWallLayoutItem = {
  readonly installationId: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly orientation: 'portrait' | 'landscape';
};
