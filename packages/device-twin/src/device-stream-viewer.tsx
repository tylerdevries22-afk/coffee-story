'use client';

import { useEffect, useRef } from 'react';

import type { DeviceSignalTransport } from './stream-protocol';
import { startDeviceStreamViewer } from './webrtc';

export function DeviceStreamViewer(props: {
  readonly label: string;
  readonly sessionId: string;
  readonly iceServers: readonly RTCIceServer[];
  readonly transport: DeviceSignalTransport;
  readonly onEnded?: () => void;
}) {
  const { iceServers, label, onEnded, sessionId, transport } = props;
  const video = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const player = video.current;
    let controller: Awaited<ReturnType<typeof startDeviceStreamViewer>> | null = null;
    let cancelled = false;
    void startDeviceStreamViewer({
      iceServers, onEnded, sessionId, transport,
      onStream: (stream) => {
        if (player) player.srcObject = stream;
      },
    }).then((value) => {
      if (cancelled) value.stop();
      else controller = value;
    }).catch(() => onEnded?.());
    return () => {
      cancelled = true;
      controller?.stop();
      if (player) player.srcObject = null;
    };
  }, [iceServers, onEnded, sessionId, transport]);
  return <video aria-label={`${label} live screen`} autoPlay muted playsInline ref={video} />;
}
