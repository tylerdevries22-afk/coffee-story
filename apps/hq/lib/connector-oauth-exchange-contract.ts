import type { OAuthConnectorKey } from './connector-oauth-config';
import type { ConnectorToken } from './connector-oauth-exchange';
import {
  isBoundedConnectorCredential,
  isBoundedConnectorIdentity,
  isBoundedConnectorToken,
} from './connector-oauth-token-bounds';

const MANAGED = new Set<OAuthConnectorKey>([
  'google-suite', 'youtube', 'quickbooks-online', 'slack', 'tiktok',
]);
const MAX_ACCESS_LIFETIME_SECONDS = 30 * 24 * 60 * 60;
const MAX_META_LIFETIME_SECONDS = 90 * 24 * 60 * 60;
const MAX_REFRESH_LIFETIME_SECONDS = 2 * 366 * 24 * 60 * 60;

function objectAt(source: unknown, key: string): Record<string, unknown> | null {
  if (!source || typeof source !== 'object') return null;
  const value = Reflect.get(source, key);
  return value && typeof value === 'object' ? value as Record<string, unknown> : null;
}

function stringAt(source: unknown, key: string): string | null {
  if (!source || typeof source !== 'object') return null;
  const value = Reflect.get(source, key);
  return typeof value === 'string' && value.trim() ? value : null;
}

function positiveNumber(source: object, key: string, maximum: number): boolean {
  const value = Reflect.get(source, key);
  return typeof value === 'number' && Number.isSafeInteger(value)
    && value > 0 && value <= maximum;
}

const TOKEN_FIELDS = [
  'access_token', 'refresh_token', 'expires_in', 'refresh_expires_in',
  'token_type', 'scope', 'id_token', 'open_id', 'stripe_user_id', 'livemode',
] as const;

/** Retain only credential fields used by this application. */
export function issuedConnectorToken(
  key: OAuthConnectorKey,
  payload: unknown,
): ConnectorToken | null {
  const source = key === 'tiktok' ? objectAt(payload, 'data') ?? payload : payload;
  if (!source || typeof source !== 'object') return null;
  const accessToken = stringAt(source, 'access_token');
  if (!isBoundedConnectorToken(accessToken)) return null;
  const token: Record<string, unknown> = { access_token: accessToken };
  for (const field of TOKEN_FIELDS) {
    const value = Reflect.get(source, field);
    if (field !== 'access_token'
      && (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')) {
      token[field] = value;
    }
  }
  return isBoundedConnectorCredential(token) ? token as ConnectorToken : null;
}

/** Validate every field needed before a one-use provider response can be stored. */
export function initialConnectorToken(
  key: OAuthConnectorKey,
  payload: unknown,
): ConnectorToken | null {
  const token = issuedConnectorToken(key, payload);
  if (!token) return null;
  const accessToken = stringAt(token, 'access_token');
  if (!isBoundedConnectorToken(accessToken)) return null;
  if (MANAGED.has(key)) {
    const refreshToken = stringAt(token, 'refresh_token');
    if (!isBoundedConnectorToken(refreshToken)
      || !positiveNumber(token, 'expires_in', MAX_ACCESS_LIFETIME_SECONDS)) return null;
  }
  if (key === 'meta-business-suite'
    && !positiveNumber(token, 'expires_in', MAX_META_LIFETIME_SECONDS)) return null;
  if (key === 'tiktok') {
    const tokenType = stringAt(token, 'token_type');
    const openId = stringAt(token, 'open_id');
    if (tokenType?.toLowerCase() !== 'bearer'
      || !isBoundedConnectorIdentity(openId)
      || !positiveNumber(token, 'refresh_expires_in', MAX_REFRESH_LIFETIME_SECONDS)) return null;
  }
  return token;
}
