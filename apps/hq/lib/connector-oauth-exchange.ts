import {
  connectorProviderConfig,
  type OAuthConnectorKey,
  type ProviderConfig,
} from './connector-oauth-config';
import { readBoundedConnectorResponse } from './connector-oauth-response';
import {
  initialConnectorToken,
  issuedConnectorToken,
} from './connector-oauth-exchange-contract';
import {
  ConnectorExchangeError,
  type ConnectorToken,
} from './connector-oauth-exchange-error';
import {
  isProvablePreDeliveryFailure,
  stringAt,
} from './connector-oauth-transport';

export { isProvablePreDeliveryFailure, objectAt, stringAt } from './connector-oauth-transport';
export { ConnectorExchangeError, type ConnectorToken } from './connector-oauth-exchange-error';

const MAX_TOKEN_PAYLOAD = 20_000;
const EXCHANGE_TIMEOUT_MS = 10_000;

function basic(user: string, password = ''): string {
  return `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`;
}

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
  timeoutMs: number,
): Promise<{ readonly ok: boolean; readonly status: number; readonly payload: unknown }> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (config.useBasic) headers.Authorization = basicHeader(key, config);
  const deadline = Number.isFinite(timeoutMs)
    ? Math.min(EXCHANGE_TIMEOUT_MS, Math.max(1, Math.trunc(timeoutMs)))
    : EXCHANGE_TIMEOUT_MS;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), deadline);
    try {
      let response: Response;
      if (config.tokenMethod === 'GET') {
        const url = new URL(config.tokenUrl);
        for (const [name, entry] of params) url.searchParams.set(name, entry);
        response = await fetch(url.toString(), { headers, signal: controller.signal });
      } else {
        response = await fetch(config.tokenUrl, {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/x-www-form-urlencoded' },
          body: params,
          signal: controller.signal,
        });
      }
      const text = await readBoundedConnectorResponse(response, MAX_TOKEN_PAYLOAD, () =>
        new ConnectorExchangeError('payload', response.status, 'the token payload was oversized'));
      let payload: unknown;
      try {
        payload = JSON.parse(text) as unknown;
      } catch {
        if (attempt === 0 && response.status === 429) continue;
        throw new ConnectorExchangeError('payload', response.status, 'the response was not JSON');
      }
      const issued = issuedConnectorToken(key, payload);
      if (attempt === 0 && response.status === 429 && !issued) continue;
      const providerCode = stringAt(payload, 'error')?.trim().toLowerCase();
      if (attempt === 0
        && !issued
        && (providerCode === 'server_error' || providerCode === 'temporarily_unavailable')) {
        continue;
      }
      return { ok: response.ok, status: response.status, payload };
    } catch (error) {
      if (error instanceof ConnectorExchangeError) throw error;
      if (attempt === 0 && isProvablePreDeliveryFailure(error)) continue;
      const timedOut = controller.signal.aborted
        || (error instanceof Error && error.name === 'AbortError');
      throw new ConnectorExchangeError(
        'transport', null, timedOut ? 'the provider did not answer in time' : 'the request failed',
      );
    } finally {
      clearTimeout(timeout);
    }
  }
  throw new ConnectorExchangeError('transport', null, 'the request failed');
}

async function extendMetaToken(
  config: ProviderConfig,
  payload: unknown,
  timeoutMs: number,
): Promise<unknown> {
  const accessToken = stringAt(payload, 'access_token');
  if (!accessToken) return null;
  const response = await requestToken('meta-business-suite', config, new URLSearchParams({
    grant_type: 'fb_exchange_token',
    client_id: config.clientId,
    client_secret: config.clientSecret,
    fb_exchange_token: accessToken,
  }), timeoutMs);
  if (!response.ok) {
    throw new ConnectorExchangeError(
      'provider', response.status, 'the provider rejected the long-lived exchange',
    );
  }
  return response.payload;
}

export async function extendMetaConnectorToken(
  token: ConnectorToken,
  timeoutMs = EXCHANGE_TIMEOUT_MS,
  beforeRequest?: () => Promise<void>,
): Promise<ConnectorToken> {
  const config = connectorProviderConfig('meta-business-suite');
  if (!config) throw new ConnectorExchangeError('unconfigured', null, 'no client credentials', token);
  if (beforeRequest) await beforeRequest();
  const payload = await extendMetaToken(config, token, timeoutMs);
  const extended = initialConnectorToken('meta-business-suite', payload);
  if (!extended) {
    throw new ConnectorExchangeError('payload', 200, 'invalid token contract', token);
  }
  return extended;
}

export async function exchangeConnectorCode(
  key: OAuthConnectorKey,
  code: string,
  verifier: string,
  callbackUrl: string,
  timeoutMs = EXCHANGE_TIMEOUT_MS,
): Promise<ConnectorToken> {
  const config = connectorProviderConfig(key);
  if (!config) throw new ConnectorExchangeError('unconfigured', null, 'no client credentials');
  const response = await requestToken(
    key, config, exchangeParams(config, code, verifier, callbackUrl), timeoutMs,
  );
  const issued = issuedConnectorToken(key, response.payload);
  if (!response.ok) {
    throw new ConnectorExchangeError(
      'provider', response.status, 'the provider rejected the exchange', issued,
    );
  }
  if (key === 'slack' && (!response.payload || typeof response.payload !== 'object'
    || Reflect.get(response.payload, 'ok') !== true)) {
    throw new ConnectorExchangeError(
      'provider', response.status, 'the provider rejected the exchange', issued,
    );
  }
  let payload = response.payload;
  if (key === 'meta-business-suite') {
    if (!issued) {
      throw new ConnectorExchangeError('payload', response.status, 'invalid token contract');
    }
    try {
      return await extendMetaConnectorToken(issued, timeoutMs);
    } catch (error) {
      if (error instanceof ConnectorExchangeError) {
        throw new ConnectorExchangeError(
          error.stage, error.status, 'post-exchange credential processing failed', issued,
        );
      }
      throw error;
    }
  }
  const token = initialConnectorToken(key, payload);
  if (!token) {
    throw new ConnectorExchangeError(
      'payload', response.status, 'invalid token contract', issuedConnectorToken(key, payload) ?? issued,
    );
  }
  return token;
}
