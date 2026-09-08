import { fetchWithRetry } from '@platform/api-client';

import {
  connectorProviderScopes,
  connectorScopeSource,
  type OAuthConnectorKey,
} from './connector-oauth-config';
import { stringAt, type ConnectorToken } from './connector-oauth-exchange';

const META_PERMISSIONS = 'https://graph.facebook.com/v25.0/me/permissions';

/**
 * The scopes a provider itself says it granted.
 *
 * Returns `null`, never the requested list, when the provider reports nothing.
 * Assuming the request would record a declined permission as consent, and the
 * first sync would then fail with a provider permission error instead of the card
 * showing a scope gap. `null` means "unknown", which callers must not treat as a
 * successful connection.
 */
export function grantedConnectorScopes(token: ConnectorToken): readonly string[] | null {
  const reported = stringAt(token, 'scope');
  if (!reported) return null;
  return [...new Set(reported.split(/[\s,]+/).filter(Boolean))];
}

/**
 * Asks Meta which permissions survived its consent screen.
 *
 * Meta's token response carries no `scope` field and its dialog lets a user
 * decline individual permissions, so `/me/permissions` is the only truthful
 * source. Returns `null` when it cannot be reached, which is deliberately
 * distinct from an empty grant: one is an unknown, the other is an answer.
 */
async function metaGrantedScopes(token: ConnectorToken): Promise<readonly string[] | null> {
  try {
    const response = await fetchWithRetry(
      META_PERMISSIONS,
      { headers: { Accept: 'application/json', Authorization: `Bearer ${token.access_token}` } },
    );
    if (!response.ok) return null;
    const rows = Reflect.get(await response.json() as object, 'data');
    if (!Array.isArray(rows)) return null;
    return [...new Set(rows
      .filter((row) => stringAt(row, 'status') === 'granted')
      .map((row) => stringAt(row, 'permission'))
      .filter((permission): permission is string => permission !== null))];
  } catch {
    return null;
  }
}

/**
 * Resolves the scopes the user actually granted, or `null` if that cannot be
 * established. A caller must fail the connection on `null` rather than storing an
 * installation whose capability set would be silently empty.
 *
 * What an absent `scope` field means is a per-provider fact, not a guess:
 *
 * - A `token`-reporting provider supports declining individual permissions and
 *   always returns the field, so its absence is anomalous and stays unknown.
 * - A `request` provider omits it by design. RFC 6749 section 5.1 defines that as
 *   "the scope of the access token is identical to the scope requested", and the
 *   provider offers no way to decline part of it, so the request is the answer.
 *   Intuit is the one here; treating its silence as a failure would make
 *   QuickBooks impossible to connect at all.
 * - A `verify` provider omits it but does allow declining, so it must be asked.
 */
export async function resolveGrantedScopes(
  key: OAuthConnectorKey,
  token: ConnectorToken,
): Promise<readonly string[] | null> {
  const reported = grantedConnectorScopes(token);
  if (reported) return reported;
  const source = connectorScopeSource(key);
  if (source === 'request') return connectorProviderScopes(key);
  return source === 'verify' ? metaGrantedScopes(token) : null;
}
