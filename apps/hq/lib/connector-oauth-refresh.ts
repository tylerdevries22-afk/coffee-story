import {
  connectorProviderConfig,
  type OAuthConnectorKey,
  type ProviderConfig,
} from './connector-oauth-config';
import { objectAt, stringAt, type ConnectorToken } from './connector-oauth-exchange';

const MAX_BODY_BYTES = 20_000;
const MAX_TIMEOUT_MS = 8_000;
const ATTEMPTS = 2;

export class ConnectorRefreshError extends Error {
  constructor(
    readonly stage: 'unsupported' | 'transport' | 'provider' | 'payload',
    readonly status: number | null,
  ) {
    super(`Connector token refresh failed at ${stage}.`);
    this.name = 'ConnectorRefreshError';
  }
}

function basic(config: ProviderConfig): string {
  return `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64')}`;
}

function refreshRequest(
  key: OAuthConnectorKey,
  config: ProviderConfig,
  refreshToken: string,
): { readonly url: string; readonly init: RequestInit } | null {
  const fields: Record<string, string> = {
    grant_type: 'refresh_token', refresh_token: refreshToken,
  };
  let authorization: string | undefined;
  switch (key) {
    case 'google-suite':
    case 'youtube':
      fields.client_id = config.clientId;
      fields.client_secret = config.clientSecret;
      break;
    case 'quickbooks-online':
      authorization = basic(config);
      break;
    case 'slack':
      fields.client_id = config.clientId;
      fields.client_secret = config.clientSecret;
      break;
    case 'tiktok':
      fields.client_key = config.clientId;
      fields.client_secret = config.clientSecret;
      break;
    case 'stripe':
    case 'meta-business-suite':
      return null;
  }
  return {
    url: config.tokenUrl,
    init: {
      method: 'POST', body: new URLSearchParams(fields),
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
        ...(authorization ? { Authorization: authorization } : {}),
      },
    },
  };
}

async function readBoundedJson(response: Response): Promise<unknown> {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    await response.body?.cancel();
    throw new ConnectorRefreshError('payload', response.status);
  }
  if (!response.body) return null;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = '';
  let bytes = 0;
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    bytes += part.value.byteLength;
    if (bytes > MAX_BODY_BYTES) {
      await reader.cancel();
      throw new ConnectorRefreshError('payload', response.status);
    }
    text += decoder.decode(part.value, { stream: true });
  }
  try {
    return JSON.parse(text + decoder.decode()) as unknown;
  } catch {
    throw new ConnectorRefreshError('payload', response.status);
  }
}

function tokenPayload(key: OAuthConnectorKey, payload: unknown): unknown {
  if (key === 'tiktok') return objectAt(payload, 'data') ?? payload;
  return payload;
}

function refreshedToken(
  key: OAuthConnectorKey,
  payload: unknown,
  previousRefreshToken: string,
): ConnectorToken {
  if (key === 'slack' && (!payload || typeof payload !== 'object'
    || Reflect.get(payload, 'ok') !== true)) {
    throw new ConnectorRefreshError('provider', 200);
  }
  const token = tokenPayload(key, payload);
  const accessToken = stringAt(token, 'access_token');
  if (!accessToken || !token || typeof token !== 'object') {
    throw new ConnectorRefreshError('payload', 200);
  }
  return {
    ...(token as Record<string, unknown>),
    access_token: accessToken,
    refresh_token: stringAt(token, 'refresh_token') ?? previousRefreshToken,
    acquired_at: new Date().toISOString(),
  };
}

/** Refresh an expiring grant. Stripe and Meta do not expose this token contract. */
export async function refreshConnectorToken(
  key: OAuthConnectorKey,
  credential: ConnectorToken,
  timeoutMs = MAX_TIMEOUT_MS,
): Promise<ConnectorToken | null> {
  const refreshToken = stringAt(credential, 'refresh_token');
  const config = connectorProviderConfig(key);
  if (!config || !refreshToken) return null;
  const spec = refreshRequest(key, config, refreshToken);
  if (!spec) return null;
  const deadline = Number.isFinite(timeoutMs)
    ? Math.max(1, Math.min(MAX_TIMEOUT_MS, Math.trunc(timeoutMs))) : MAX_TIMEOUT_MS;
  for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), deadline);
    try {
      const response = await fetch(spec.url, { ...spec.init, signal: controller.signal });
      if (response.status === 429 || response.status >= 500) {
        await response.body?.cancel();
        if (attempt + 1 < ATTEMPTS) continue;
        throw new ConnectorRefreshError('provider', response.status);
      }
      const payload = await readBoundedJson(response);
      if (!response.ok) throw new ConnectorRefreshError('provider', response.status);
      return refreshedToken(key, payload, refreshToken);
    } catch (error) {
      if (error instanceof ConnectorRefreshError) throw error;
      if (attempt + 1 === ATTEMPTS) throw new ConnectorRefreshError('transport', null);
    } finally {
      clearTimeout(timer);
    }
  }
  throw new ConnectorRefreshError('provider', null);
}

export function connectorTokenExpiry(token: ConnectorToken, now: Date): string | null {
  const seconds = Reflect.get(token, 'expires_in');
  return typeof seconds === 'number' && Number.isFinite(seconds) && seconds > 0
    ? new Date(now.getTime() + seconds * 1_000).toISOString() : null;
}
