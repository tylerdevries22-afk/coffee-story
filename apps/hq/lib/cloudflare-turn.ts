import { fetchWithRetry } from '@platform/api-client';

import { DeviceWallServiceError } from './device-wall-registration';

export type IceServer = {
  readonly urls: readonly string[];
  readonly username?: string;
  readonly credential?: string;
};

const ICE_URL = /^(?:stun|stuns|turn|turns):[^\s]{1,2042}$/;
const CLOUDFLARE_DNS_PORT = /cloudflare\.com:53(?:[/?]|$)/i;

function validIceServer(value: unknown): value is IceServer {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const source = value as Record<string, unknown>;
  return Array.isArray(source.urls) && source.urls.length > 0 && source.urls.length <= 8
    && source.urls.every((url) => typeof url === 'string' && ICE_URL.test(url))
    && (source.username === undefined || (typeof source.username === 'string' && source.username.length <= 1_024))
    && (source.credential === undefined || (typeof source.credential === 'string' && source.credential.length <= 1_024));
}

export function normalizeIceServers(value: unknown): readonly IceServer[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > 8 || !value.every(validIceServer)) return null;
  const servers = value.map((server) => ({
    ...server,
    urls: server.urls.filter((url) => !CLOUDFLARE_DNS_PORT.test(url)),
  })).filter((server) => server.urls.length > 0);
  return servers.length > 0 ? servers : null;
}

/** Generates per-session credentials; the long-lived TURN key never leaves the server. */
export async function generateTurnCredentials(sessionId: string): Promise<readonly IceServer[]> {
  const keyId = process.env.CLOUDFLARE_TURN_KEY_ID;
  const token = process.env.CLOUDFLARE_TURN_API_TOKEN;
  if (!keyId || !token) {
    throw new DeviceWallServiceError(503, 'turn_not_configured', 'Secure relay service is not configured.');
  }
  const response = await fetchWithRetry(
    `https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(keyId)}/credentials/generate-ice-servers`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`, 'Content-Type': 'application/json',
        'Idempotency-Key': sessionId,
      },
      body: JSON.stringify({ ttl: 900, customIdentifier: sessionId }),
    },
    8_000,
    2,
  );
  if (!response.ok) {
    throw new DeviceWallServiceError(503, 'turn_unavailable', 'Secure relay credentials are unavailable.');
  }
  const body: unknown = await response.json();
  const iceServers = body && typeof body === 'object' && !Array.isArray(body)
    ? normalizeIceServers((body as Record<string, unknown>).iceServers)
    : null;
  if (!iceServers) {
    throw new DeviceWallServiceError(503, 'turn_unavailable', 'Secure relay credentials are unavailable.');
  }
  return iceServers;
}
