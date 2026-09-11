import type { OAuthConnectorKey } from './connector-oauth-config';
import { objectAt, stringAt, type ConnectorToken } from './connector-oauth-exchange';
import { ConnectorRefreshError } from './connector-oauth-refresh-error';
import {
  isBoundedConnectorCredential,
  isBoundedConnectorCleanupCredential,
  isBoundedConnectorIdentity,
  isBoundedConnectorToken,
} from './connector-oauth-token-bounds';

const MAX_ACCESS_LIFETIME_SECONDS = 30 * 24 * 60 * 60;
const MAX_REFRESH_LIFETIME_SECONDS = 2 * 366 * 24 * 60 * 60;
const REFRESH_FIELDS = [
  'access_token', 'refresh_token', 'expires_in', 'refresh_expires_in',
  'token_type', 'scope', 'id_token', 'open_id',
] as const;

export function connectorRefreshFailure(
  key: OAuthConnectorKey,
  payload: unknown,
): Readonly<{
  code: 'invalid_grant' | 'provider_rejected' | 'rotation_ambiguous';
  retryable: boolean; immediate: boolean;
}> {
  const nested = objectAt(payload, 'error');
  const raw = stringAt(payload, 'error') ?? stringAt(payload, 'error_code')
    ?? stringAt(nested, 'code');
  const normalized = raw?.trim().toLowerCase().replace(/[\s-]+/gu, '_');
  if (normalized === 'invalid_grant' || normalized === 'invalid_refresh_token'
    || normalized === 'token_revoked') {
    return { code: 'invalid_grant', retryable: false, immediate: false };
  }
  const slackRetryable = key === 'slack'
    && (normalized === 'ratelimited' || normalized === 'invalid_auth');
  const slackImmediate = key === 'slack'
    && ['fatal_error', 'internal_error', 'request_timeout', 'service_unavailable']
      .includes(normalized ?? '');
  const tiktokAmbiguous = key === 'tiktok'
    && (normalized === 'server_error' || normalized === 'temporarily_unavailable');
  const reusableRetryable = key !== 'slack' && key !== 'tiktok'
    && (normalized === 'server_error' || normalized === 'temporarily_unavailable');
  return {
    code: tiktokAmbiguous ? 'rotation_ambiguous' : 'provider_rejected',
    retryable: slackRetryable || reusableRetryable,
    immediate: slackImmediate,
  };
}

function partialIssuedCredential(token: object, accessToken: string): ConnectorToken {
  const partial: Record<string, unknown> = {
    access_token: accessToken, acquired_at: new Date().toISOString(),
  };
  for (const field of REFRESH_FIELDS) {
    if (field === 'access_token') continue;
    const value = Reflect.get(token, field);
    if (typeof value !== 'string'
      && (typeof value !== 'number' || !Number.isFinite(value))) continue;
    const candidate = { ...partial, [field]: value };
    if (isBoundedConnectorCleanupCredential(candidate)) partial[field] = value;
  }
  return partial as ConnectorToken;
}

function payloadError(issuedCredential: ConnectorToken): ConnectorRefreshError {
  return new ConnectorRefreshError('payload', 200, 'payload', false, issuedCredential);
}

function normalizedScope(
  key: OAuthConnectorKey,
  token: object,
  issuedCredential: ConnectorToken,
): string | undefined {
  if (!Reflect.has(token, 'scope')) return undefined;
  const raw = Reflect.get(token, 'scope');
  const scopes = typeof raw === 'string' ? raw.split(/[\s,]+/u).filter(Boolean) : null;
  const valid = scopes !== null && scopes.length <= 32
    && scopes.every((scope) => isBoundedConnectorIdentity(scope));
  if (valid) return raw as string;
  if (key === 'quickbooks-online' || key === 'slack' || key === 'tiktok') return '';
  throw payloadError(issuedCredential);
}

function tokenPayload(key: OAuthConnectorKey, payload: unknown): unknown {
  return key === 'tiktok' ? objectAt(payload, 'data') ?? payload : payload;
}

export function refreshedConnectorToken(
  key: OAuthConnectorKey,
  payload: unknown,
  previous: ConnectorToken,
): ConnectorToken {
  const token = tokenPayload(key, payload);
  const accessToken = stringAt(token, 'access_token');
  if (!isBoundedConnectorToken(accessToken) || !token || typeof token !== 'object') {
    throw new ConnectorRefreshError('payload', 200, 'payload', false);
  }
  const issuedCredential = partialIssuedCredential(token, accessToken);
  const expiresIn = Reflect.get(token, 'expires_in');
  if (typeof expiresIn !== 'number' || !Number.isSafeInteger(expiresIn)
    || expiresIn <= 0 || expiresIn > MAX_ACCESS_LIFETIME_SECONDS) {
    throw payloadError(issuedCredential);
  }
  const protectedMetadata = {
    external_account_id: Reflect.get(previous, 'external_account_id'),
    metadata: Reflect.get(previous, 'metadata'),
  };
  const reportedRefresh = stringAt(token, 'refresh_token');
  if ((key === 'quickbooks-online' || key === 'slack' || key === 'tiktok')
    && !reportedRefresh) {
    throw payloadError(issuedCredential);
  }
  const nextRefresh = reportedRefresh ?? previous.refresh_token;
  if (nextRefresh !== undefined && !isBoundedConnectorToken(nextRefresh)) {
    throw payloadError(issuedCredential);
  }
  if (key === 'tiktok') {
    const tokenType = stringAt(token, 'token_type');
    const refreshExpiresIn = Reflect.get(token, 'refresh_expires_in');
    const openId = stringAt(token, 'open_id');
    const expectedId = Reflect.get(previous, 'external_account_id')
      ?? Reflect.get(previous, 'open_id');
    if (tokenType?.toLowerCase() !== 'bearer'
      || typeof refreshExpiresIn !== 'number' || !Number.isSafeInteger(refreshExpiresIn)
      || refreshExpiresIn <= 0 || refreshExpiresIn > MAX_REFRESH_LIFETIME_SECONDS
      || !isBoundedConnectorIdentity(expectedId)
      || !isBoundedConnectorIdentity(openId) || openId !== expectedId) {
      throw payloadError(issuedCredential);
    }
  }
  const refreshed: Record<string, unknown> = {
    access_token: accessToken, refresh_token: nextRefresh,
    ...Object.fromEntries(Object.entries(protectedMetadata)
      .filter((entry) => entry[1] !== undefined)),
    acquired_at: new Date().toISOString(),
  };
  const scope = normalizedScope(key, token, issuedCredential);
  for (const field of REFRESH_FIELDS) {
    const value = Reflect.get(token, field);
    if (field !== 'access_token' && field !== 'refresh_token'
      && field !== 'scope'
      && (typeof value === 'string' || typeof value === 'number')) refreshed[field] = value;
  }
  if (scope !== undefined) refreshed.scope = scope;
  if (!isBoundedConnectorCredential(refreshed)) {
    throw payloadError(issuedCredential);
  }
  return refreshed as ConnectorToken;
}
