import { fetchWithRetry } from '@platform/api-client';

export const OAUTH_CONNECTOR_KEYS = [
  'google-suite', 'stripe', 'quickbooks-online', 'slack',
] as const;
export type OAuthConnectorKey = (typeof OAUTH_CONNECTOR_KEYS)[number];

type ProviderConfig = {
  readonly authorizeUrl: string;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly scopes: readonly string[];
  readonly tokenUrl: string;
  readonly useBasic?: boolean;
  readonly usePkce?: boolean;
};

export type ConnectorToken = Readonly<Record<string, unknown>> & {
  readonly access_token: string;
  readonly refresh_token?: string;
};

export type ConnectorIdentity = {
  readonly accountId: string;
  readonly accountLabel: string;
};

function value(name: string): string {
  return process.env[name]?.trim() ?? '';
}

export function isOAuthConnectorKey(valueToCheck: string): valueToCheck is OAuthConnectorKey {
  return (OAUTH_CONNECTOR_KEYS as readonly string[]).includes(valueToCheck);
}

function connectorProviderConfig(key: OAuthConnectorKey): ProviderConfig | null {
  const base = key === 'google-suite' ? {
    authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    clientId: value('GOOGLE_OAUTH_CLIENT_ID'), clientSecret: value('GOOGLE_OAUTH_CLIENT_SECRET'),
    tokenUrl: 'https://oauth2.googleapis.com/token', usePkce: true,
    scopes: ['openid', 'email', 'profile', 'https://www.googleapis.com/auth/drive.file',
      'https://www.googleapis.com/auth/calendar.events', 'https://www.googleapis.com/auth/gmail.compose'],
  } : key === 'stripe' ? {
    authorizeUrl: 'https://connect.stripe.com/oauth/authorize',
    clientId: value('STRIPE_CONNECT_CLIENT_ID'), clientSecret: value('STRIPE_SECRET_KEY'),
    tokenUrl: 'https://connect.stripe.com/oauth/token', useBasic: true, scopes: [],
  } : key === 'quickbooks-online' ? {
    authorizeUrl: 'https://appcenter.intuit.com/connect/oauth2',
    clientId: value('QUICKBOOKS_CLIENT_ID'), clientSecret: value('QUICKBOOKS_CLIENT_SECRET'),
    tokenUrl: 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer',
    useBasic: true, scopes: ['com.intuit.quickbooks.accounting'],
  } : {
    authorizeUrl: 'https://slack.com/oauth/v2/authorize',
    clientId: value('SLACK_CLIENT_ID'), clientSecret: value('SLACK_CLIENT_SECRET'),
    tokenUrl: 'https://slack.com/api/oauth.v2.access', usePkce: true,
    scopes: ['channels:read', 'chat:write'],
  } satisfies ProviderConfig;
  return base.clientId && base.clientSecret ? base : null;
}

export function connectorProviderReady(key: OAuthConnectorKey): boolean {
  return connectorProviderConfig(key) !== null;
}
export function connectorProviderScopes(key: OAuthConnectorKey): readonly string[] {
  return connectorProviderConfig(key)?.scopes ?? [];
}

export function connectorCallbackUrl(key: OAuthConnectorKey, requestOrigin: string): string | null {
  const configured = value('CONNECTOR_PUBLIC_ORIGIN') || value('PLATFORM_BASE_URL');
  const candidate = configured || (process.env.NODE_ENV !== 'production' ? requestOrigin : '');
  try {
    const origin = new URL(candidate);
    const local = origin.hostname === '127.0.0.1' || origin.hostname === 'localhost';
    if (origin.origin !== candidate.replace(/\/$/, '') || (origin.protocol !== 'https:' && !local)) return null;
    return `${origin.origin}/api/connectors/${key}/callback`;
  } catch { return null; }
}

export function connectorAuthorizationUrl(
  key: OAuthConnectorKey,
  state: string,
  codeChallenge: string,
  callbackUrl: string,
): URL | null {
  const config = connectorProviderConfig(key);
  if (!config) return null;
  const url = new URL(config.authorizeUrl);
  url.searchParams.set('client_id', config.clientId);
  url.searchParams.set('redirect_uri', callbackUrl);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('state', state);
  if (config.scopes.length) url.searchParams.set('scope', config.scopes.join(key === 'slack' ? ',' : ' '));
  if (config.usePkce) {
    url.searchParams.set('code_challenge', codeChallenge);
    url.searchParams.set('code_challenge_method', 'S256');
  }
  if (key === 'google-suite') {
    url.searchParams.set('access_type', 'offline');
    url.searchParams.set('include_granted_scopes', 'true');
    url.searchParams.set('prompt', 'consent');
  }
  return url;
}

function basic(user: string, password = ''): string {
  return `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`;
}

function stringAt(valueToRead: unknown, key: string): string | null {
  if (!valueToRead || typeof valueToRead !== 'object') return null;
  const result = Reflect.get(valueToRead, key);
  return typeof result === 'string' && result.trim() ? result : null;
}

function objectAt(valueToRead: unknown, key: string): Record<string, unknown> | null {
  if (!valueToRead || typeof valueToRead !== 'object') return null;
  const result = Reflect.get(valueToRead, key);
  return result && typeof result === 'object' ? result as Record<string, unknown> : null;
}

export async function exchangeConnectorCode(
  key: OAuthConnectorKey,
  code: string,
  verifier: string,
  callbackUrl: string,
): Promise<ConnectorToken> {
  const config = connectorProviderConfig(key);
  if (!config) throw new Error('Connector OAuth is not configured.');
  const body = new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: callbackUrl });
  if (config.usePkce) body.set('code_verifier', verifier);
  if (!config.useBasic) {
    body.set('client_id', config.clientId);
    body.set('client_secret', config.clientSecret);
  }
  const response = await fetchWithRetry(config.tokenUrl, {
    method: 'POST', headers: {
      Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded',
      ...(config.useBasic ? { Authorization: basic(
        key === 'stripe' ? config.clientSecret : config.clientId,
        key === 'stripe' ? '' : config.clientSecret,
      ) } : {}),
    }, body,
  });
  const token: unknown = await response.json();
  const accessToken = stringAt(token, 'access_token');
  const encoded = token && typeof token === 'object' ? JSON.stringify(token) : '';
  if (!response.ok || !accessToken || accessToken.length > 16_384 || encoded.length > 20_000) {
    throw new Error('Connector token exchange failed.');
  }
  return { ...(token as Record<string, unknown>), access_token: accessToken };
}

async function identityJson(url: string, accessToken: string): Promise<unknown> {
  const response = await fetchWithRetry(url, {
    headers: { Accept: 'application/json', Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) throw new Error('Connector identity verification failed.');
  return response.json();
}

export async function verifyConnectorIdentity(
  key: OAuthConnectorKey,
  token: ConnectorToken,
  realmId: string | null,
): Promise<ConnectorIdentity> {
  if (key === 'google-suite') {
    const identity = await identityJson('https://openidconnect.googleapis.com/v1/userinfo', token.access_token);
    const id = stringAt(identity, 'sub'); const email = stringAt(identity, 'email');
    if (id && email) return { accountId: id, accountLabel: email };
  }
  if (key === 'stripe') {
    const identity = await identityJson('https://api.stripe.com/v1/account', token.access_token);
    const id = stringAt(identity, 'id');
    if (id) return { accountId: id, accountLabel: stringAt(identity, 'display_name') ?? id };
  }
  if (key === 'slack') {
    const identity = await identityJson('https://slack.com/api/auth.test', token.access_token);
    const id = stringAt(identity, 'team_id'); const name = stringAt(identity, 'team');
    if (objectAt({ identity }, 'identity')?.ok === true && id && name) {
      return { accountId: id, accountLabel: name };
    }
  }
  if (key === 'quickbooks-online' && realmId && /^\d{1,32}$/.test(realmId)) {
    const sandbox = value('QUICKBOOKS_ENV') !== 'production';
    const host = sandbox ? 'sandbox-quickbooks.api.intuit.com' : 'quickbooks.api.intuit.com';
    const identity = await identityJson(`https://${host}/v3/company/${realmId}/companyinfo/${realmId}?minorversion=75`, token.access_token);
    const company = objectAt(identity, 'CompanyInfo');
    const id = stringAt(company, 'Id'); const name = stringAt(company, 'CompanyName');
    if (id && name) return { accountId: id, accountLabel: name };
  }
  throw new Error('Connector identity verification failed.');
}

export function grantedConnectorScopes(key: OAuthConnectorKey, token: ConnectorToken): readonly string[] {
  const reported = stringAt(token, 'scope');
  if (reported) return [...new Set(reported.split(/[\s,]+/).filter(Boolean))];
  return connectorProviderConfig(key)?.scopes ?? [];
}
