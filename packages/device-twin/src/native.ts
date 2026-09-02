import { registerGlobals } from 'react-native-webrtc';

import type { DeviceSignalTransport } from './stream-protocol';
import { startBrowserScreenShare, type StreamController } from './webrtc';

/**
 * ReplayKit on iOS and MediaProjection on Android are invoked only from this
 * user-triggered call. Both operating systems retain their own consent UI.
 */
export async function startNativeScreenShare(options: {
  readonly sessionId: string;
  readonly iceServers: readonly RTCIceServer[];
  readonly transport: DeviceSignalTransport;
}): Promise<StreamController> {
  registerGlobals();
  return startBrowserScreenShare(options);
}
