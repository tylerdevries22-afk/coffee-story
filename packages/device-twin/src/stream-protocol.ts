export type DeviceStreamSignal = {
  readonly sessionId: string;
  readonly kind: 'offer' | 'answer' | 'candidate' | 'stop' | 'denied';
  readonly description?: RTCSessionDescriptionInit;
  readonly candidate?: RTCIceCandidateInit;
};

export type DeviceSignalTransport = {
  readonly send: (signal: DeviceStreamSignal) => Promise<void>;
  readonly subscribe: (listener: (signal: DeviceStreamSignal) => void) => () => void;
};

const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function description(value: unknown, expected: 'offer' | 'answer'): RTCSessionDescriptionInit | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  if (record.type !== expected || typeof record.sdp !== 'string' || record.sdp.length > 100_000) return undefined;
  return { type: expected, sdp: record.sdp };
}

function candidate(value: unknown): RTCIceCandidateInit | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  if (typeof record.candidate !== 'string' || record.candidate.length > 4096
      || (record.sdpMid !== undefined && (typeof record.sdpMid !== 'string' || record.sdpMid.length > 80))
      || (record.sdpMLineIndex !== undefined && (!Number.isInteger(record.sdpMLineIndex) || Number(record.sdpMLineIndex) < 0))) return undefined;
  return {
    candidate: record.candidate,
    ...(typeof record.sdpMid === 'string' ? { sdpMid: record.sdpMid } : {}),
    ...(typeof record.sdpMLineIndex === 'number' ? { sdpMLineIndex: record.sdpMLineIndex } : {}),
  };
}

export function parseDeviceStreamSignal(value: unknown): DeviceStreamSignal | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.sessionId !== 'string' || !SESSION_ID.test(record.sessionId)) return null;
  if (!['offer', 'answer', 'candidate', 'stop', 'denied'].includes(String(record.kind))) return null;
  const kind = record.kind as DeviceStreamSignal['kind'];
  const parsedDescription = kind === 'offer' || kind === 'answer'
    ? description(record.description, kind)
    : undefined;
  const parsedCandidate = candidate(record.candidate);
  if ((kind === 'offer' || kind === 'answer') && !parsedDescription) return null;
  if (kind === 'candidate' && !parsedCandidate) return null;
  return {
    sessionId: record.sessionId,
    kind,
    ...(parsedDescription ? { description: parsedDescription } : {}),
    ...(parsedCandidate ? { candidate: parsedCandidate } : {}),
  };
}
