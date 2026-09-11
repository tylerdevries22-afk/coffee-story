import {
  connectorProviderConfig,
  type OAuthConnectorKey,
  type ProviderConfig,
} from './connector-oauth-config';
import { isProvablePreDeliveryFailure, stringAt, type ConnectorToken } from './connector-oauth-exchange';
import { ConnectorRefreshError } from './connector-oauth-refresh-error';
import { connectorRefreshFailure, refreshedConnectorToken } from './connector-oauth-refresh-payload';
import { cancelConnectorResponse, readBoundedConnectorResponse } from './connector-oauth-response';
import { connectorCredentialBytes, MAX_CONNECTOR_CREDENTIAL_BYTES } from './connector-oauth-token-bounds';

const MAX_BODY_BYTES = MAX_CONNECTOR_CREDENTIAL_BYTES;
const MAX_TIMEOUT_MS = 8_000;
const ATTEMPTS = 2;
export { ConnectorRefreshError } from './connector-oauth-refresh-error';

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

async function readBoundedJson(response: Response, maxBytes: number): Promise<unknown> {
  const text = await readBoundedConnectorResponse(response, maxBytes, () =>
    new ConnectorRefreshError('payload', response.status, 'payload', false));
  try {
    return text ? JSON.parse(text) as unknown : null;
  } catch {
    throw new ConnectorRefreshError('payload', response.status, 'payload', false);
  }
}

/** Refresh an expiring grant. Stripe and Meta do not expose this token contract. */
export async function refreshConnectorToken(
  key: OAuthConnectorKey,
  credential: ConnectorToken,
  timeoutMs = MAX_TIMEOUT_MS,
  settlementReserveBytes = 0,
  beforeRequest?: () => Promise<void>,
): Promise<ConnectorToken | null> {
  const refreshToken = stringAt(credential, 'refresh_token');
  const reusable = key === 'google-suite' || key === 'youtube' || key === 'quickbooks-online';
  const config = connectorProviderConfig(key);
  if (refreshToken && !config) {
    throw new ConnectorRefreshError(
      'unconfigured', null, 'configuration_unavailable', true,
    );
  }
  const spec = config && refreshToken ? refreshRequest(key, config, refreshToken) : null;
  if (!spec) return null;
  const stableBytes = connectorCredentialBytes({
    external_account_id: Reflect.get(credential, 'external_account_id'),
    metadata: Reflect.get(credential, 'metadata'),
    ...((key === 'google-suite' || key === 'youtube')
      ? { refresh_token: refreshToken } : {}),
    acquired_at: new Date().toISOString(),
  });
  const responseLimit = stableBytes === null ? 0
    : MAX_BODY_BYTES - Math.max(0, settlementReserveBytes) - stableBytes - 256;
  if (responseLimit < 1_024) {
    throw new ConnectorRefreshError('payload', null, 'credential_contract_invalid', false);
  }
  const deadline = Number.isFinite(timeoutMs)
    ? Math.max(1, Math.min(MAX_TIMEOUT_MS, Math.trunc(timeoutMs))) : MAX_TIMEOUT_MS;
  if (beforeRequest) await beforeRequest();
  let slackAmbiguousRotation = false;
  for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), deadline);
    try {
      const response = await fetch(spec.url, { ...spec.init, signal: controller.signal });
      if (response.status === 429) {
        await cancelConnectorResponse(response);
        if (slackAmbiguousRotation) {
          throw new ConnectorRefreshError('provider', 429, 'rotation_ambiguous', false);
        }
        if (key !== 'tiktok' && attempt + 1 < ATTEMPTS) continue;
        throw new ConnectorRefreshError(
          'provider', response.status, 'provider_rejected', true,
        );
      }
      if (response.status >= 500) {
        await cancelConnectorResponse(response);
        if (key === 'slack' && attempt + 1 < ATTEMPTS) {
          slackAmbiguousRotation = true;
          continue;
        }
        throw new ConnectorRefreshError(
          'provider', response.status,
          key === 'slack' || key === 'tiktok' ? 'rotation_ambiguous' : 'provider_rejected',
          reusable,
        );
      }
      const payload = await readBoundedJson(response, responseLimit);
      if (!response.ok || (key === 'slack'
        && (!payload || typeof payload !== 'object' || Reflect.get(payload, 'ok') !== true))) {
        const failure = connectorRefreshFailure(key, payload);
        if (slackAmbiguousRotation) {
          throw new ConnectorRefreshError('provider', response.status, 'rotation_ambiguous', false);
        }
        if (failure.immediate && attempt + 1 < ATTEMPTS) {
          slackAmbiguousRotation = key === 'slack';
          continue;
        }
        throw new ConnectorRefreshError(
          'provider', response.status,
          failure.immediate ? 'rotation_ambiguous' : failure.code, failure.retryable,
        );
      }
      return refreshedConnectorToken(key, payload, credential);
    } catch (error) {
      if (error instanceof ConnectorRefreshError) {
        if (error.stage === 'payload' && key === 'slack' && !error.issuedCredential
          && attempt + 1 < ATTEMPTS) {
          slackAmbiguousRotation = true;
          continue;
        }
        if (error.stage === 'payload' && (key === 'slack' || key === 'tiktok')) {
          throw new ConnectorRefreshError(
            'payload', error.status, 'rotation_ambiguous', false, error.issuedCredential,
          );
        }
        if (error.stage === 'payload' && reusable) {
          throw new ConnectorRefreshError(
            'payload', error.status, 'payload', true, error.issuedCredential,
          );
        }
        throw error;
      }
      const preDelivery = isProvablePreDeliveryFailure(error);
      if (key === 'slack' && slackAmbiguousRotation) {
        throw new ConnectorRefreshError('transport', null, 'rotation_ambiguous', false);
      }
      if (attempt + 1 < ATTEMPTS && key !== 'tiktok' && (preDelivery || key === 'slack')) {
        slackAmbiguousRotation = key === 'slack' && !preDelivery;
        continue;
      }
      throw new ConnectorRefreshError(
        'transport', null,
        (key === 'slack' || key === 'tiktok') && !preDelivery ? 'rotation_ambiguous' : 'transport',
        preDelivery || reusable,
      );
    } finally {
      clearTimeout(timer);
    }
  }
  throw new ConnectorRefreshError('provider', null, 'provider_rejected', true);
}

export function connectorTokenExpiry(token: ConnectorToken, now: Date): string | null {
  const seconds = Reflect.get(token, 'expires_in');
  return typeof seconds === 'number' && Number.isSafeInteger(seconds)
    && seconds > 0 && seconds <= 30 * 24 * 60 * 60
    ? new Date(now.getTime() + seconds * 1_000).toISOString() : null;
}
