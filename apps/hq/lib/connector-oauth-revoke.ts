import {
  connectorProviderConfig,
  META_GRAPH_VERSION,
  type OAuthConnectorKey,
  type ProviderConfig,
} from './connector-oauth-config';
import { stringAt, type ConnectorToken } from './connector-oauth-exchange';
import {
  connectorRevocationResponse,
  type ConnectorRevocationResult,
} from './connector-oauth-revoke-response';

const REVOKE_TIMEOUT_MS = 5_000;
const REVOKE_ATTEMPTS = 2;

type RevocationSpec = { readonly url: string; readonly init: RequestInit };
export type { ConnectorRevocationResult } from './connector-oauth-revoke-response';

function basic(user: string, password: string): string {
  return `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`;
}

function form(values: Readonly<Record<string, string>>): URLSearchParams {
  return new URLSearchParams(values);
}

function formRequest(body: URLSearchParams, authorization?: string): RequestInit {
  return {
    method: 'POST', body,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
      ...(authorization ? { Authorization: authorization } : {}),
    },
  };
}

function revocationSpec(
  key: OAuthConnectorKey,
  config: ProviderConfig | null,
  token: ConnectorToken,
  accountId?: string,
): RevocationSpec | null {
  const accessToken = token.access_token;
  const durableToken = stringAt(token, 'refresh_token') ?? accessToken;
  switch (key) {
    case 'google-suite':
    case 'youtube':
      return {
        url: 'https://oauth2.googleapis.com/revoke',
        init: formRequest(form({ token: durableToken })),
      };
    case 'stripe': {
      if (!config) return null;
      const stripeAccount = accountId ?? stringAt(token, 'stripe_user_id');
      return stripeAccount ? {
        url: 'https://connect.stripe.com/oauth/deauthorize',
        init: formRequest(
          form({ client_id: config.clientId, stripe_user_id: stripeAccount }),
          basic(config.clientSecret, ''),
        ),
      } : null;
    }
    case 'quickbooks-online':
      if (!config) return null;
      return {
        url: 'https://developer.api.intuit.com/v2/oauth2/tokens/revoke',
        init: {
          method: 'POST', body: JSON.stringify({ token: durableToken }),
          headers: {
            Accept: 'application/json', 'Content-Type': 'application/json',
            Authorization: basic(config.clientId, config.clientSecret),
          },
        },
      };
    case 'slack':
      if (!config) return null;
      return {
        url: 'https://slack.com/api/apps.uninstall',
        init: formRequest(form({
          client_id: config.clientId, client_secret: config.clientSecret, token: accessToken,
        })),
      };
    case 'meta-business-suite':
      return {
        url: `https://graph.facebook.com/${META_GRAPH_VERSION}/me/permissions`,
        init: { method: 'DELETE', headers: { Accept: 'application/json', Authorization: `Bearer ${accessToken}` } },
      };
    case 'tiktok':
      if (!config) return null;
      return {
        url: 'https://open.tiktokapis.com/v2/oauth/revoke/',
        init: formRequest(form({
          client_key: config.clientId, client_secret: config.clientSecret, token: accessToken,
        })),
      };
  }
}

export async function revokeConnectorTokenDetailed(
  key: OAuthConnectorKey,
  token: ConnectorToken,
  accountId?: string,
  timeoutMs = REVOKE_TIMEOUT_MS,
): Promise<ConnectorRevocationResult> {
  const config = connectorProviderConfig(key);
  if (!config && !['google-suite', 'youtube', 'meta-business-suite'].includes(key)) {
    return { revoked: false, retryable: true, code: 'configuration_unavailable' };
  }
  const spec = revocationSpec(key, config, token, accountId);
  if (!spec) return { revoked: false, retryable: false, code: 'provider_rejected' };
  const deadline = Number.isFinite(timeoutMs) ? Math.max(1, Math.min(timeoutMs, REVOKE_TIMEOUT_MS)) : REVOKE_TIMEOUT_MS;
  for (let attempt = 0; attempt < REVOKE_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), deadline);
    try {
      const response = await fetch(spec.url, { ...spec.init, signal: controller.signal });
      const transient = response.status === 429 || response.status >= 500;
      if (!transient) {
        const result = await connectorRevocationResponse(key, response,
          accountId ?? stringAt(token, 'stripe_user_id') ?? undefined);
        if (result.code === 'credential_invalid'
          || !result.retryable || attempt + 1 === REVOKE_ATTEMPTS) return result;
      } else await response.body?.cancel();
    } catch { /* revocation is idempotent; one bounded retry is safe */ }
    finally { clearTimeout(timeout); }
  }
  return { revoked: false, retryable: true, code: 'transport' };
}

/** Revoke an exchanged credential that the database did not accept. */
export async function revokeConnectorToken(
  key: OAuthConnectorKey,
  token: ConnectorToken,
  accountId?: string,
  timeoutMs = REVOKE_TIMEOUT_MS,
): Promise<boolean> {
  return (await revokeConnectorTokenDetailed(key, token, accountId, timeoutMs)).revoked;
}
