/**
 * Talking to the pairing endpoints.
 *
 * Deliberately plain `fetch` rather than the ApiClient: that client requires an
 * access token to build a request, and the entire point of pairing is that this
 * tablet does not have one yet.
 */
import type { StoredDeviceToken } from '@/lib/device-token';
import { parseStoredDeviceToken } from '@/lib/device-token';
import { apiBaseUrl } from '@/lib/api';

const TIMEOUT_MS = 15_000;

export type PairResult =
  | { ok: true; token: StoredDeviceToken }
  | { ok: false; error: string; revoked?: boolean };

export async function pairDevice(code: string, tenantSlug: string): Promise<PairResult> {
  return post('/api/devices/pair', { code, tenantSlug }, undefined, tenantSlug);
}

export async function refreshDevice(token: string, tenantSlug: string): Promise<PairResult> {
  return post('/api/devices/refresh', {}, token, tenantSlug);
}

async function post(
  path: string,
  body: unknown,
  token: string | undefined,
  tenantSlug: string,
): Promise<PairResult> {
  const base = apiBaseUrl();
  if (!base) return { ok: false, error: 'This kiosk has no platform API configured.' };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (response.status === 401) {
      // The refresh path's 401 means the row says no: revoked, re-paired, or
      // simply gone. That is different from "the network ate it".
      return { ok: false, error: 'This device is no longer paired.', revoked: true };
    }
    if (!response.ok) {
      const detail = (await response.json().catch(() => null)) as { message?: string } | null;
      return { ok: false, error: detail?.message ?? 'That code did not work.' };
    }
    const payload = await response.json() as unknown;
    const record = typeof payload === 'object' && payload !== null && !Array.isArray(payload)
      ? payload as Record<string, unknown>
      : {};
    const parsed = parseStoredDeviceToken({ ...record, tenantSlug });
    return parsed
      ? { ok: true, token: parsed }
      : { ok: false, error: 'The platform returned an invalid device credential.' };
  } catch {
    return { ok: false, error: 'Could not reach the platform. Check the shop network.' };
  } finally {
    clearTimeout(timer);
  }
}
