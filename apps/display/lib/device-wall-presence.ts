import { deviceToken } from './device-token';

const HEARTBEAT_TIMEOUT_MS = 5_000;
const HEARTBEAT_ATTEMPTS = 2;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type PresenceDependencies = Readonly<{
  fetcher?: typeof fetch;
  hqOrigin?: string;
  token?: string | null;
}>;

export function installationIdFromDeviceToken(token: string): string | null {
  const payload = token.split('.')[1];
  if (!payload) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      device_id?: unknown;
    };
    return typeof parsed.device_id === 'string' && UUID.test(parsed.device_id)
      ? parsed.device_id
      : null;
  } catch {
    return null;
  }
}

export async function recordDeviceWallPresence(
  locationId: string,
  dependencies: PresenceDependencies = {},
): Promise<boolean> {
  if (!UUID.test(locationId)) return false;
  const token = dependencies.token === undefined ? await deviceToken() : dependencies.token;
  const hqOrigin = dependencies.hqOrigin ?? process.env.HQ_ORIGIN;
  if (!token || !hqOrigin) return false;
  const installationId = installationIdFromDeviceToken(token);
  if (!installationId) return false;

  let endpoint: string;
  try { endpoint = new URL('/api/device-wall/heartbeat', hqOrigin).toString(); }
  catch { return false; }

  const fetcher = dependencies.fetcher ?? fetch;
  for (let attempt = 1; attempt <= HEARTBEAT_ATTEMPTS; attempt += 1) {
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), HEARTBEAT_TIMEOUT_MS);
    try {
      const response = await fetcher(endpoint, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ installationId, locationId }),
        cache: 'no-store',
        signal: abort.signal,
      });
      if (response.ok) return true;
      if (response.status < 500) return false;
    } catch {
      // Network and timeout failures receive one bounded retry.
    } finally {
      clearTimeout(timer);
    }
  }
  return false;
}
