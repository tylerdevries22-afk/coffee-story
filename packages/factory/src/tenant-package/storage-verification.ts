import { createHash } from 'node:crypto';

import { requestWithRetry } from './http';
import { TenantPackageError } from './types';

const MIB = 1024 * 1024;
const VERIFY_INACTIVITY_MS = 30_000;
const VERIFY_HEARTBEAT_MS = 5 * 60_000;

export type VerificationOptions = {
  heartbeatMs?: number;
  inactivityMs?: number;
  totalMs?: (size: number) => number;
};

export function verificationDeadlineMs(size: number): number {
  return Math.min(30 * 60_000, 60_000 + Math.ceil(size / MIB) * 2_000);
}

async function nextChunk(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  inactivityMs: number,
  signal: AbortSignal,
): Promise<ReadableStreamReadResult<Uint8Array>> {
  let timer: NodeJS.Timeout | undefined;
  let abort: (() => void) | undefined;
  const stalled = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('verification_inactive')), inactivityMs);
  });
  const aborted = new Promise<never>((_, reject) => {
    abort = () => reject(new Error('verification_aborted'));
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
  });
  try {
    return await Promise.race([reader.read(), stalled, aborted]);
  } finally {
    if (timer) clearTimeout(timer);
    if (abort) signal.removeEventListener('abort', abort);
  }
}

async function verifyAttempt(input: {
  url: URL;
  headers: Record<string, string>;
  beforeMutation: () => Promise<void>;
  size: number;
  digest: string;
  deadline: number;
  heartbeatMs: number;
  inactivityMs: number;
}): Promise<boolean> {
  await input.beforeMutation();
  const remainingMs = input.deadline - Date.now();
  if (remainingMs <= 0) return false;
  const controller = new AbortController();
  const deadlineTimer = setTimeout(() => controller.abort(), remainingMs);
  let response: Response | undefined;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let heartbeatError: unknown;
  let heartbeatRequest: Promise<void> | undefined;
  const heartbeatTimer = setInterval(() => {
    if (heartbeatRequest) return;
    heartbeatRequest = input.beforeMutation().catch((error: unknown) => {
      heartbeatError = error;
      controller.abort();
    }).finally(() => { heartbeatRequest = undefined; });
  }, input.heartbeatMs);
  try {
    response = await requestWithRetry(
      input.url,
      { headers: input.headers, signal: controller.signal },
      [200],
      remainingMs,
    );
    if (heartbeatError) throw heartbeatError;
    if (!response.body) throw new Error('missing_body');
    reader = response.body.getReader();
    const hash = createHash('sha256');
    let received = 0;
    while (true) {
      const chunk = await nextChunk(reader, input.inactivityMs, controller.signal);
      if (chunk.done) break;
      received += chunk.value.byteLength;
      if (received > input.size) throw new Error('body_too_large');
      hash.update(chunk.value);
      if (heartbeatError) throw heartbeatError;
    }
    clearInterval(heartbeatTimer);
    const finalHeartbeat = heartbeatRequest;
    if (finalHeartbeat) await finalHeartbeat;
    if (heartbeatError) throw heartbeatError;
    return received === input.size && `sha256:${hash.digest('hex')}` === input.digest;
  } catch {
    if (heartbeatError) throw heartbeatError;
    return false;
  } finally {
    clearInterval(heartbeatTimer);
    clearTimeout(deadlineTimer);
    controller.abort();
    if (reader) await reader.cancel().catch(() => undefined);
    else await response?.body?.cancel().catch(() => undefined);
    try { reader?.releaseLock(); } catch { /* Cleanup never masks verification. */ }
    const pendingHeartbeat = heartbeatRequest;
    if (pendingHeartbeat) await pendingHeartbeat;
    if (heartbeatError) throw heartbeatError;
  }
}

export async function verifyStoredObject(input: {
  url: URL;
  headers: Record<string, string>;
  beforeMutation: () => Promise<void>;
  objectSize: number;
  digest: string;
  options?: VerificationOptions;
}): Promise<void> {
  const heartbeatMs = input.options?.heartbeatMs ?? VERIFY_HEARTBEAT_MS;
  const inactivityMs = input.options?.inactivityMs ?? VERIFY_INACTIVITY_MS;
  const totalMs = input.options?.totalMs ?? verificationDeadlineMs;
  const deadline = Date.now() + totalMs(input.objectSize);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) break;
    if (await verifyAttempt({
      url: input.url,
      headers: input.headers,
      beforeMutation: input.beforeMutation,
      size: input.objectSize,
      digest: input.digest,
      deadline,
      heartbeatMs,
      inactivityMs,
    })) return;
  }
  throw new TenantPackageError(
    'object_verification_failed',
    'Uploaded tenant object failed verification.',
  );
}
