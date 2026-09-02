import type { DeviceCapability, DiagnosticKey } from './types';

export type DiagnosticCheck = {
  readonly key: DiagnosticKey;
  readonly label: string;
  readonly requires: DeviceCapability | null;
};

export const SAFE_DIAGNOSTICS: readonly DiagnosticCheck[] = [
  { key: 'heartbeat', label: 'Heartbeat latency', requires: 'heartbeat' },
  { key: 'reconnect', label: 'Reconnect readiness', requires: 'heartbeat' },
  { key: 'authentication', label: 'Authentication state', requires: null },
  { key: 'runtime', label: 'App and runtime compatibility', requires: null },
  { key: 'capture_permission', label: 'Capture permission readiness', requires: 'screen_capture' },
  { key: 'signaling', label: 'Private signaling', requires: 'webrtc' },
  { key: 'peer_connection', label: 'Peer connection', requires: 'webrtc' },
  { key: 'turn', label: 'TURN fallback', requires: 'turn' },
];

export function diagnosticPlan(capabilities: readonly DeviceCapability[]): readonly DiagnosticCheck[] {
  return SAFE_DIAGNOSTICS.filter((check) => !check.requires || capabilities.includes(check.requires));
}
