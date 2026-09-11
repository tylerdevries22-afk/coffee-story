import { setTimeout as delay } from 'node:timers/promises';

import { TenantPackageError } from './types';

const ATTEMPTS = 3;
const TIMEOUT_MS = 30_000;

export function safeEndpoint(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new TenantPackageError('endpoint_invalid', 'Supabase endpoint must use HTTPS.');
  }
  const local = url.hostname === '127.0.0.1' || url.hostname === 'localhost';
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) {
    throw new TenantPackageError('endpoint_invalid', 'Supabase endpoint must use HTTPS.');
  }
  return url;
}

export function serviceHeaders(serviceKey: string): Record<string, string> {
  if (!serviceKey) throw new TenantPackageError('service_key_missing', 'Supabase credentials are missing.');
  return { apikey: serviceKey, authorization: `Bearer ${serviceKey}` };
}

export async function requestWithRetry(
  url: string | URL,
  init: RequestInit,
  accepted: readonly number[] = [200],
  timeoutMs = TIMEOUT_MS,
): Promise<Response> {
  let lastStatus = 0;
  for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
    try {
      const timeout = AbortSignal.timeout(timeoutMs);
      const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
      const response = await fetch(url, { ...init, signal });
      if (accepted.includes(response.status)) return response;
      lastStatus = response.status;
      await response.body?.cancel().catch(() => undefined);
      if (response.status < 500 && response.status !== 408 && response.status !== 429) break;
    } catch {
      // Network and timeout failures follow the same bounded retry path.
    }
    if (init.signal?.aborted) break;
    if (attempt < ATTEMPTS - 1) await delay(200 * (2 ** attempt) + Math.floor(Math.random() * 100));
  }
  throw new TenantPackageError(
    'remote_request_failed',
    `Supabase request failed${lastStatus ? ` with status ${lastStatus}` : ''}.`,
  );
}

export async function discardResponse(response: Response): Promise<void> {
  await response.body?.cancel().catch(() => undefined);
}

export async function readBoundedJson(
  response: Response,
  maxBytes: number,
): Promise<unknown> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
    await discardResponse(response);
    throw new TenantPackageError('remote_response_invalid', 'Remote response is invalid.');
  }
  const declaredLength = response.headers.get('content-length');
  if (declaredLength !== null
    && (!/^\d+$/.test(declaredLength) || Number(declaredLength) > maxBytes)) {
    await discardResponse(response);
    throw new TenantPackageError('remote_response_invalid', 'Remote response is invalid.');
  }
  const reader = response.body?.getReader();
  if (!reader) {
    throw new TenantPackageError('remote_response_invalid', 'Remote response is invalid.');
  }
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      length += chunk.value.byteLength;
      if (length > maxBytes) {
        throw new TenantPackageError('remote_response_invalid', 'Remote response is invalid.');
      }
      chunks.push(chunk.value);
    }
    const json = new TextDecoder('utf-8', { fatal: true })
      .decode(Buffer.concat(chunks, length));
    return JSON.parse(json) as unknown;
  } catch (error) {
    if (error instanceof TenantPackageError) throw error;
    throw new TenantPackageError('remote_response_invalid', 'Remote response is invalid.');
  } finally {
    await reader.cancel().catch(() => undefined);
    try { reader.releaseLock(); } catch { /* Cleanup never masks decoding. */ }
  }
}

export function encodeObjectPath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/');
}
