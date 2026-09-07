import { fetchWithRetry } from '@platform/api-client';

import {
  connectorProviderConfig,
  connectorProviderScopes,
  type OAuthConnectorKey,
  type ProviderConfig,
} from './connector-oauth-config';

export type ConnectorToken = Readonly<Record<string, unknown>> & {
  readonly access_token: string;
  readonly refresh_token?: string;
};

const MAX_ACCESS_TOKEN = 16_384;
const MAX_TOKEN_PAYLOAD = 20_000;

export function stringAt(source: unknown, key: string): string | null {
  if (!source || typeof source !== 'object') return null;
  const result = Reflect.get(source, key);
  return typeof result === 'string' && result.trim() ? result : null;
}

export function objectAt(source: unknown, key: string): Record<string, unknown> | null {
  if (!source || typeof source !== 'object') return null;
  const result = Reflect.get(source, key);
  return result && typeof result === 'object' ? result as Record<string, unknown> : null;
}

function basic(user: string, password = ''): string {
  return `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`;
}

/** Stripe authenticates the token call with its secret key as the Basic user. */
function basicHeader(key: OAuthConnectorKey, config: ProviderConfig): string {
  return key === 'stripe'
    ? basic(config.clientSecret)
    : basic(config.clientId, config.clientSecret);
}

function exchangeParams(
  config: ProviderConfig,
  code: string,
  verifier: string,
  callbackUrl: string,
): URLSearchParams {
  const params = new URLSearchParams({
    grant_type: 'authorization_code', code, redirect_uri: callbackUrl,
  });
  if (config.usePkce) params.set('code_verifier', verifier);
  if (!config.useBasic) {
    params.set(config.clientIdParam ?? 'client_id', config.clientId);
    params.set('client_secret', config.clientSecret);
  }
  return params;
}

async function requestToken(
  key: OAuthConnectorKey,
  config: ProviderConfig,
  params: URLSearchParams,
): Promise<Response> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (config.useBasic) headers.Authorization = basicHeader(key, config);
  if (config.tokenMethod === 'GET') {
    const url = new URL(config.tokenUrl);
    for (const [name, entry] of params) url.searchParams.set(name, entry);
    return fetchWithRetry(url.toString(), { headers });
  }
  return fetchWithRetry(config.tokenUrl, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params,
  });
}

/**
 * TikTok answers with the token fields nested under `data` on some app versions
 * and at the top level on others, so accept either shape.
 */
function tokenBody(key: OAuthConnectorKey, payload: unknown): unknown {
  if (key !== 'tiktok') return payload;
  const nested = objectAt(payload, 'data');
  return nested && stringAt(nested, 'access_token') ? nested : payload;
}

export async function exchangeConnectorCode(
  key: OAuthConnectorKey,
  code: string,
  verifier: string,
  callbackUrl: string,
): Promise<ConnectorToken> {
  const config = connectorProviderConfig(key);
  if (!config) throw new Error('Connector OAuth is not configured.');
  const response = await requestToken(
    key, config, exchangeParams(config, code, verifier, callbackUrl),
  );
  const token = tokenBody(key, await response.json() as unknown);
  const accessToken = stringAt(token, 'access_token');
  const encoded = token && typeof token === 'object' ? JSON.stringify(token) : '';
  if (!response.ok || !accessToken || accessToken.length > MAX_ACCESS_TOKEN
    || encoded.length > MAX_TOKEN_PAYLOAD) {
    throw new Error('Connector token exchange failed.');
  }
  return { ...(token as Record<string, unknown>), access_token: accessToken };
}

export function grantedConnectorScopes(
  key: OAuthConnectorKey,
  token: ConnectorToken,
): readonly string[] {
  const reported = stringAt(token, 'scope');
  if (reported) return [...new Set(reported.split(/[\s,]+/).filter(Boolean))];
  return connectorProviderScopes(key);
}
