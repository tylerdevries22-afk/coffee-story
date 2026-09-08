import { fetchWithRetry } from '@platform/api-client';

import { connectorProviderScopes, type OAuthConnectorKey } from './connector-oauth-config';
import { stringAt, type ConnectorToken } from './connector-oauth-exchange';

const META_PERMISSIONS = 'https://graph.facebook.com/v25.0/me/permissions';

export function grantedConnectorScopes(
  key: OAuthConnectorKey,
  token: ConnectorToken,
): readonly string[] {
  const reported = stringAt(token, 'scope');
  if (reported) return [...new Set(reported.split(/[\s,]+/).filter(Boolean))];
  return connectorProviderScopes(key);
}

/**
 * Resolves the scopes the user actually granted.
 *
 * Meta's token response carries no `scope` field, and its consent screen lets a
 * user decline individual permissions, so falling back to the requested list
 * would record declined scopes as granted and the first sync would fail with a
 * permission error instead of the card showing a scope gap. `/me/permissions` is
 * the only truthful source, so Meta is asked directly.
 */
export async function resolveGrantedScopes(
  key: OAuthConnectorKey,
  token: ConnectorToken,
): Promise<readonly string[]> {
  if (key !== 'meta-business-suite' || stringAt(token, 'scope')) {
    return grantedConnectorScopes(key, token);
  }
  try {
    const response = await fetchWithRetry(
      META_PERMISSIONS,
      { headers: { Accept: 'application/json', Authorization: `Bearer ${token.access_token}` } },
    );
    if (!response.ok) return [];
    const rows = Reflect.get(await response.json() as object, 'data');
    if (!Array.isArray(rows)) return [];
    return [...new Set(rows
      .filter((row) => stringAt(row, 'status') === 'granted')
      .map((row) => stringAt(row, 'permission'))
      .filter((permission): permission is string => permission !== null))];
  } catch {
    // A scope list we could not verify is recorded as empty, never as the full
    // request: an empty list reads as a gap, an assumed list reads as consent.
    return [];
  }
}
