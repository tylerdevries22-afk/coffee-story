import type { DeviceSignalTransport, DeviceStreamSignal } from './stream-protocol';

export type StreamController = { readonly stop: () => void };

function peerConfig(iceServers: readonly RTCIceServer[]): RTCConfiguration {
  return {
    iceServers: iceServers.map((server) => ({
      ...server,
      urls: Array.isArray(server.urls) ? [...server.urls] : server.urls,
    })),
    bundlePolicy: 'max-bundle',
  };
}

function candidateSignal(sessionId: string, candidate: RTCIceCandidate): DeviceStreamSignal {
  return { sessionId, kind: 'candidate', candidate: candidate.toJSON() };
}

export async function startDeviceStreamViewer(options: {
  readonly sessionId: string;
  readonly iceServers: readonly RTCIceServer[];
  readonly transport: DeviceSignalTransport;
  readonly onStream: (stream: MediaStream) => void;
  readonly onEnded?: () => void;
}): Promise<StreamController> {
  const peer = new RTCPeerConnection(peerConfig(options.iceServers));
  let stopped = false;
  let unsubscribe = () => {};
  const stop = (notify: boolean) => {
    if (stopped) return;
    stopped = true;
    if (notify) void options.transport.send({ sessionId: options.sessionId, kind: 'stop' }).catch(() => undefined);
    unsubscribe();
    peer.close();
  };
  peer.addTransceiver('video', { direction: 'recvonly' });
  peer.ontrack = (event) => event.streams[0] && options.onStream(event.streams[0]);
  peer.onicecandidate = (event) => {
    if (event.candidate) void options.transport.send(candidateSignal(options.sessionId, event.candidate));
  };
  unsubscribe = options.transport.subscribe((signal) => {
    if (signal.sessionId !== options.sessionId) return;
    void (async () => {
      if (signal.kind === 'answer' && signal.description) await peer.setRemoteDescription(signal.description);
      if (signal.kind === 'candidate' && signal.candidate) await peer.addIceCandidate(signal.candidate);
      if (signal.kind === 'stop' || signal.kind === 'denied') {
        stop(false);
        options.onEnded?.();
      }
    })().catch(() => options.onEnded?.());
  });
  const offer = await peer.createOffer();
  await peer.setLocalDescription(offer);
  await options.transport.send({ sessionId: options.sessionId, kind: 'offer', description: offer });
  return {
    stop: () => stop(true),
  };
}

export async function startBrowserScreenShare(options: {
  readonly sessionId: string;
  readonly iceServers: readonly RTCIceServer[];
  readonly transport: DeviceSignalTransport;
}): Promise<StreamController> {
  if (!navigator.mediaDevices?.getDisplayMedia) throw new Error('Screen capture is unavailable.');
  const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
  const peer = new RTCPeerConnection(peerConfig(options.iceServers));
  let stopped = false;
  let unsubscribe = () => {};
  stream.getVideoTracks().forEach((track) => peer.addTrack(track, stream));
  const stop = (notify: boolean) => {
    if (stopped) return;
    stopped = true;
    if (notify) void options.transport.send({ sessionId: options.sessionId, kind: 'stop' }).catch(() => undefined);
    unsubscribe();
    stream.getTracks().forEach((track) => track.stop());
    peer.close();
  };
  stream.getVideoTracks()[0]?.addEventListener('ended', () => {
    stop(true);
  }, { once: true });
  peer.onicecandidate = (event) => {
    if (event.candidate) void options.transport.send(candidateSignal(options.sessionId, event.candidate));
  };
  unsubscribe = options.transport.subscribe((signal) => {
    if (signal.sessionId !== options.sessionId) return;
    void (async () => {
      if (signal.kind === 'offer' && signal.description) {
        await peer.setRemoteDescription(signal.description);
        const answer = await peer.createAnswer();
        await peer.setLocalDescription(answer);
        await options.transport.send({ sessionId: options.sessionId, kind: 'answer', description: answer });
      }
      if (signal.kind === 'candidate' && signal.candidate) await peer.addIceCandidate(signal.candidate);
      if (signal.kind === 'stop') stop(false);
    })().catch(() => stop(false));
  });
  return { stop: () => stop(true) };
}
