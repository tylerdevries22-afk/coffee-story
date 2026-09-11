import {
  connectorProviderConfig,
  META_GRAPH_VERSION,
  type OAuthConnectorKey,
  type ProviderConfig,
} from './connector-oauth-config';
import { stringAt, type ConnectorToken } from './connector-oauth-exchange';

const REVOKE_TIMEOUT_MS = 5_000;
const REVOKE_ATTEMPTS = 2;
const MAX_RESPONSE_BYTES = 16_384;

type RevocationSpec = { readonly url: string; readonly init: RequestInit };

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
  config: ProviderConfig,
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
      const stripeAccount = stringAt(token, 'stripe_user_id') ?? accountId;
      return stripeAccount ? {
        url: 'https://connect.stripe.com/oauth/deauthorize',
        init: formRequest(
          form({ client_id: config.clientId, stripe_user_id: stripeAccount }),
          basic(config.clientSecret, ''),
        ),
      } : null;
    }
    case 'quickbooks-online':
      return {
        url: 'https://developer.api.intuit.com/v2/oauth2/tokens/revoke',
        init: formRequest(
          form({ token: durableToken }), basic(config.clientId, config.clientSecret),
        ),
      };
    case 'slack':
      return {
        url: 'https://slack.com/api/auth.revoke',
        init: formRequest(form({ test: 'false' }), `Bearer ${accessToken}`),
      };
    case 'meta-business-suite':
      return {
        url: `https://graph.facebook.com/${META_GRAPH_VERSION}/me/permissions`,
        init: { method: 'DELETE', headers: { Accept: 'application/json', Authorization: `Bearer ${accessToken}` } },
      };
    case 'tiktok':
      return {
        url: 'https://open.tiktokapis.com/v2/oauth/revoke/',
        init: formRequest(form({
          client_key: config.clientId, client_secret: config.clientSecret, token: accessToken,
        })),
      };
  }
}

function revocationSpecs(
  key: OAuthConnectorKey,
  config: ProviderConfig,
  token: ConnectorToken,
  accountId?: string,
): readonly RevocationSpec[] | null {
  if (key !== 'slack') {
    const spec = revocationSpec(key, config, token, accountId);
    return spec ? [spec] : null;
  }
  const refreshToken = stringAt(token, 'refresh_token');
  const issuedTokens = refreshToken ? [refreshToken, token.access_token] : [token.access_token];
  return issuedTokens.map((issuedToken) => ({
    url: 'https://slack.com/api/auth.revoke',
    init: formRequest(form({ test: 'false' }), `Bearer ${issuedToken}`),
  }));
}

async function readSmallJson(response: Response): Promise<unknown> {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) {
    await response.body?.cancel();
    throw new Error('oversized revocation response');
  }
  if (!response.body) return null;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = '';
  let bytes = 0;
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    bytes += part.value.byteLength;
    if (bytes > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new Error('oversized revocation response');
    }
    text += decoder.decode(part.value, { stream: true });
  }
  text += decoder.decode();
  return text ? JSON.parse(text) as unknown : null;
}

async function providerAccepted(key: OAuthConnectorKey, response: Response): Promise<boolean> {
  if (!response.ok) {
    await response.body?.cancel();
    return false;
  }
  if (key !== 'slack' && key !== 'meta-business-suite') return true;
  const payload = await readSmallJson(response);
  if (!payload || typeof payload !== 'object') return false;
  return key === 'slack'
    ? Reflect.get(payload, 'ok') === true && Reflect.get(payload, 'revoked') === true
    : Reflect.get(payload, 'success') === true;
}

/** Revoke an exchanged credential that the database did not accept. */
export async function revokeConnectorToken(
  key: OAuthConnectorKey,
  token: ConnectorToken,
  accountId?: string,
  timeoutMs = REVOKE_TIMEOUT_MS,
): Promise<boolean> {
  const config = connectorProviderConfig(key);
  const specs = config ? revocationSpecs(key, config, token, accountId) : null;
  if (!specs) return false;
  const deadline = Number.isFinite(timeoutMs) ? Math.max(1, Math.min(timeoutMs, REVOKE_TIMEOUT_MS)) : REVOKE_TIMEOUT_MS;
  for (const spec of specs) {
    let revoked = false;
    for (let attempt = 0; attempt < REVOKE_ATTEMPTS; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), deadline);
      try {
        const response = await fetch(spec.url, { ...spec.init, signal: controller.signal });
        const transient = response.status === 429 || response.status >= 500;
        if (!transient) {
          revoked = await providerAccepted(key, response);
          break;
        }
        await response.body?.cancel();
      } catch { /* one bounded retry handles transport and response failures */ }
      finally { clearTimeout(timeout); }
    }
    if (!revoked) return false;
  }
  return true;
}
