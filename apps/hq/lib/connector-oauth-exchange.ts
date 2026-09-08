import {
  connectorProviderConfig,
  type OAuthConnectorKey,
  type ProviderConfig,
} from './connector-oauth-config';

export type ConnectorToken = Readonly<Record<string, unknown>> & {
  readonly access_token: string;
  readonly refresh_token?: string;
};

const MAX_ACCESS_TOKEN = 16_384;
const MAX_TOKEN_PAYLOAD = 20_000;
const EXCHANGE_TIMEOUT_MS = 10_000;

/**
 * Raised when a token exchange fails, naming the stage so the caller can report
 * which step broke. The message is safe to log: it never carries the code, the
 * verifier, or any credential.
 */
export class ConnectorExchangeError extends Error {
  readonly stage: 'unconfigured' | 'transport' | 'provider' | 'payload';

  readonly status: number | null;

  constructor(stage: ConnectorExchangeError['stage'], status: number | null, detail: string) {
    super(`Connector token exchange failed at ${stage}: ${detail}`);
    this.name = 'ConnectorExchangeError';
    this.stage = stage;
    this.status = status;
  }
}

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

/**
 * Sends the token request exactly once.
 *
 * An authorization code is single-use, so this deliberately does not go through
 * `fetchWithRetry`: that helper treats GET as safe and would retry, and Meta's
 * token endpoint is a GET. A replay burns the code and forces the owner back
 * through consent even though the first grant succeeded. The timeout is kept.
 */
async function requestToken(
  key: OAuthConnectorKey,
  config: ProviderConfig,
  params: URLSearchParams,
): Promise<Response> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (config.useBasic) headers.Authorization = basicHeader(key, config);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), EXCHANGE_TIMEOUT_MS);
  try {
    if (config.tokenMethod === 'GET') {
      const url = new URL(config.tokenUrl);
      for (const [name, entry] of params) url.searchParams.set(name, entry);
      return await fetch(url.toString(), { headers, signal: controller.signal });
    }
    return await fetch(config.tokenUrl, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params,
      signal: controller.signal,
    });
  } catch (error) {
    const timedOut = error instanceof Error && error.name === 'AbortError';
    throw new ConnectorExchangeError(
      'transport', null, timedOut ? 'the provider did not answer in time' : 'the request failed',
    );
  } finally {
    clearTimeout(timeout);
  }
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
  if (!config) throw new ConnectorExchangeError('unconfigured', null, 'no client credentials');
  const response = await requestToken(
    key, config, exchangeParams(config, code, verifier, callbackUrl),
  );
  // A throttled or blocked provider answers with HTML, so parse before trusting
  // the body and never let a SyntaxError escape this function's contract.
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new ConnectorExchangeError('payload', response.status, 'the response was not JSON');
  }
  if (!response.ok) {
    throw new ConnectorExchangeError(
      'provider', response.status,
      stringAt(payload, 'error_description') ?? stringAt(payload, 'error') ?? 'the provider rejected it',
    );
  }
  const token = tokenBody(key, payload);
  const accessToken = stringAt(token, 'access_token');
  const encoded = token && typeof token === 'object' ? JSON.stringify(token) : '';
  if (!accessToken) throw new ConnectorExchangeError('payload', response.status, 'no access token');
  if (accessToken.length > MAX_ACCESS_TOKEN || encoded.length > MAX_TOKEN_PAYLOAD) {
    throw new ConnectorExchangeError('payload', response.status, 'the token payload was oversized');
  }
  return { ...(token as Record<string, unknown>), access_token: accessToken };
}
