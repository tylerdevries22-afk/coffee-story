import type { OAuthConnectorKey } from './connector-oauth-config';
import { connectorCredentialBytes } from './connector-oauth-token-bounds';

export type ConnectorIdentityHint = Readonly<{ realmId?: string }>;

function acceptedRealm(value: unknown): value is string {
  return typeof value === 'string' && /^\d{1,32}$/u.test(value);
}

/** Capture only provider data needed to verify identity after an interrupted callback. */
export function callbackConnectorIdentityHint(
  provider: OAuthConnectorKey,
  realmId: string | null,
): ConnectorIdentityHint | null {
  return provider === 'quickbooks-online'
    ? acceptedRealm(realmId) ? { realmId } : null
    : {};
}

/** Fail closed if durable job metadata is not the exact shape this app issued. */
export function parseConnectorIdentityHint(
  provider: OAuthConnectorKey,
  value: unknown,
): ConnectorIdentityHint | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || (connectorCredentialBytes(value) ?? Infinity) > 2_048) return null;
  const keys = Object.keys(value);
  if (provider === 'quickbooks-online') {
    const realmId = Reflect.get(value, 'realmId');
    return keys.length === 1 && acceptedRealm(realmId) ? { realmId } : null;
  }
  return keys.length === 0 ? {} : null;
}
