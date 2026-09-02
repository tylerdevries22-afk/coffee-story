import { canRequestScreenView, type DeviceAppTarget, type DeviceInstallationSummary, type DeviceWallPolicy } from '@platform/device-wall';

export type DeviceConnectionAction = 'diagnose' | 'request_stream' | 'none';

export type DeviceConnectionFlow = {
  readonly action: DeviceConnectionAction;
  readonly actionLabel: string | null;
  readonly description: string;
  readonly guidance: string;
  readonly heading: string;
  readonly streamEligible: boolean;
};

const APP_NAMES: Readonly<Record<DeviceAppTarget, string>> = {
  operator: 'Operator',
  pickup_queue: 'Pickup Queue',
  kiosk_pos: 'Kiosk / POS',
};

function enrollmentGuidance(target: DeviceAppTarget) {
  if (target === 'operator') {
    return 'Open Operator at the assigned location and sign in. It registers with its protected device identity on startup.';
  }
  return 'Create a one-time, location-bound pairing code from Add device, then enter it on the device within ten minutes.';
}

/** Chooses the one safe connection path without creating a remote-control path. */
export function deviceConnectionFlow(
  installation: DeviceInstallationSummary,
  policy: DeviceWallPolicy,
  canStream: boolean,
): DeviceConnectionFlow {
  const app = APP_NAMES[installation.appTarget];
  if (installation.connectionState === 'archived') {
    return { action: 'none', actionLabel: null, heading: 'Installation archived', description: 'Archived installations cannot accept new connection requests.', guidance: 'Enroll a new installation before reconnecting this device.', streamEligible: false };
  }
  if (installation.connectionState === 'provisioning') {
    return { action: 'none', actionLabel: null, heading: 'Complete enrollment', description: `${app} is waiting for its first protected heartbeat.`, guidance: enrollmentGuidance(installation.appTarget), streamEligible: false };
  }
  if (installation.connectionState !== 'online') {
    return { action: 'diagnose', actionLabel: 'Run connection check', heading: 'Waiting for device reconnect', description: 'The device needs a current heartbeat before a secure connection request can be sent.', guidance: 'A safe check verifies heartbeat, identity, and runtime compatibility without accessing the camera, microphone, clipboard, files, or screen.', streamEligible: false };
  }
  const streamEligible = canStream && canRequestScreenView(installation);
  if (streamEligible) {
    return { action: 'request_stream', actionLabel: 'Request secure connection', heading: 'Ready for device consent', description: 'The device user must approve operating-system screen capture before any pixels are shared.', guidance: 'Video travels directly over encrypted WebRTC, is never recorded, and can be stopped on the device at any time.', streamEligible: true };
  }
  const unavailable = policy.rollout === 'registration_only'
    ? 'Screen viewing is staged until the owner beta rollout.'
    : 'This installation is missing the required screen-sharing capabilities.';
  return { action: 'diagnose', actionLabel: 'Run connection check', heading: 'Connection readiness', description: unavailable, guidance: 'A safe check verifies heartbeat, identity, and runtime compatibility without accessing the camera, microphone, clipboard, files, or screen.', streamEligible: false };
}
