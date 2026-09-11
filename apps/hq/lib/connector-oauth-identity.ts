import { fetchExternalWithRetry } from '@platform/engine';

import { objectAt, stringAt, type ConnectorToken } from './connector-oauth-exchange';
import { connectorQuickBooksEnvironment, type OAuthConnectorKey } from './connector-oauth-config';
import { isBoundedConnectorIdentity } from './connector-oauth-token-bounds';

export type ConnectorIdentity = Readonly<{ accountId: string; accountLabel: string }>;

const FAILED = 'Connector identity verification failed.';

export class ConnectorIdentityError extends Error {
  constructor(readonly code: 'credential_invalid' | 'provider_unavailable' | 'payload' = 'payload',
    readonly retryable = false) {
    super(FAILED);
    this.name = 'ConnectorIdentityError';
  }
}
const MAX_ACCOUNT_LABEL = 160;

type ConnectorReadOptions = Readonly<{ timeoutMs?: number; retryDelayMs?: number }>;

function boundedIdentity(accountId: string, accountLabel: string): ConnectorIdentity | null {
  const id = accountId.trim();
  const label = accountLabel.replace(/\s+/gu, ' ').trim();
  if (!isBoundedConnectorIdentity(id) || !label) return null;
  return { accountId: id, accountLabel: [...label].slice(0, MAX_ACCOUNT_LABEL).join('') };
}

async function identityJson(
  url: string,
  accessToken: string,
  options: ConnectorReadOptions,
): Promise<unknown> {
  const response = await fetchExternalWithRetry(url, {
    headers: { Accept: 'application/json', Authorization: `Bearer ${accessToken}` },
  }, { maxResponseBytes: 262_144, ...options });
  if (!response.ok) {
    throw new ConnectorIdentityError(
      response.status === 429 || response.status >= 500
        ? 'provider_unavailable' : 'credential_invalid',
      response.status === 429 || response.status >= 500,
    );
  }
  try {
    return await response.json();
  } catch {
    throw new ConnectorIdentityError('payload', true);
  }
}

async function googleIdentity(token: ConnectorToken, options: ConnectorReadOptions) {
  const identity = await identityJson(
    'https://openidconnect.googleapis.com/v1/userinfo', token.access_token, options,
  );
  const id = stringAt(identity, 'sub');
  const email = stringAt(identity, 'email');
  return id && email ? boundedIdentity(id, email) : null;
}

async function googleGrantIdentity(token: ConnectorToken, options: ConnectorReadOptions) {
  const identity = await identityJson(
    'https://openidconnect.googleapis.com/v1/userinfo', token.access_token, options,
  );
  const id = stringAt(identity, 'sub');
  return id ? boundedIdentity(id, stringAt(identity, 'email') ?? id) : null;
}

async function youtubeIdentity(token: ConnectorToken, options: ConnectorReadOptions) {
  const user = await identityJson(
    'https://openidconnect.googleapis.com/v1/userinfo', token.access_token, options,
  );
  const subject = stringAt(user, 'sub');
  if (!subject) return null;
  const identity = await identityJson(
    'https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true',
    token.access_token, options,
  );
  const items = Reflect.get(identity ?? {}, 'items');
  const channel = Array.isArray(items) ? items[0] as unknown : undefined;
  const channelId = stringAt(channel, 'id');
  const label = stringAt(objectAt(channel, 'snippet'), 'title') ?? channelId;
  return channelId && label ? boundedIdentity(subject, label) : null;
}

async function stripeIdentity(token: ConnectorToken, options: ConnectorReadOptions) {
  const account = await identityJson(
    'https://api.stripe.com/v1/account', token.access_token, options,
  );
  const id = stringAt(account, 'id');
  return id ? boundedIdentity(id, stringAt(account, 'display_name') ?? id) : null;
}

async function slackIdentity(
  token: ConnectorToken, options: ConnectorReadOptions, labelRequired = true,
) {
  const identity = await identityJson('https://slack.com/api/auth.test', token.access_token, options);
  if (!identity || typeof identity !== 'object' || Reflect.get(identity, 'ok') !== true) {
    const code = stringAt(identity, 'error')?.trim().toLowerCase().replace(/[\s-]+/gu, '_');
    if (['ratelimited', 'internal_error', 'request_timeout', 'service_unavailable',
      'fatal_error', 'invalid_auth'].includes(code ?? '')) {
      throw new ConnectorIdentityError('provider_unavailable', true);
    }
    if (['account_inactive', 'token_expired', 'token_revoked'].includes(code ?? '')) {
      throw new ConnectorIdentityError('credential_invalid', false);
    }
    throw new ConnectorIdentityError('payload', true);
  }
  const id = stringAt(identity, 'team_id');
  const name = stringAt(identity, 'team');
  return id && (name || !labelRequired) ? boundedIdentity(id, name ?? id) : null;
}

async function metaIdentity(token: ConnectorToken, options: ConnectorReadOptions) {
  const account = await identityJson(
    'https://graph.facebook.com/v25.0/me?fields=id,name', token.access_token, options,
  );
  const id = stringAt(account, 'id');
  return id ? boundedIdentity(id, stringAt(account, 'name') ?? id) : null;
}

async function tiktokIdentity(
  token: ConnectorToken, options: ConnectorReadOptions, issuedIdentityRequired = true,
) {
  const identity = await identityJson(
    'https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name',
    token.access_token, options,
  );
  const user = objectAt(objectAt(identity, 'data'), 'user');
  const id = stringAt(user, 'open_id');
  const issuedId = stringAt(token, 'open_id');
  if (id && issuedId && issuedId !== id) {
    throw new ConnectorIdentityError('credential_invalid', false);
  }
  return id && (issuedId === id || (!issuedId && !issuedIdentityRequired))
    ? boundedIdentity(id, stringAt(user, 'display_name') ?? id) : null;
}

async function quickbooksIdentity(
  token: ConnectorToken,
  realmId: string | null,
  options: ConnectorReadOptions,
): Promise<ConnectorIdentity | null> {
  if (!realmId || !/^\d{1,32}$/.test(realmId)) return null;
  const environment = connectorQuickBooksEnvironment();
  if (!environment) throw new ConnectorIdentityError('provider_unavailable', true);
  const host = environment === 'sandbox' ? 'sandbox-quickbooks.api.intuit.com' : 'quickbooks.api.intuit.com';
  const identity = await identityJson(
    `https://${host}/v3/company/${realmId}/companyinfo/${realmId}?minorversion=75`,
    token.access_token, options,
  );
  const company = objectAt(identity, 'CompanyInfo');
  const id = stringAt(company, 'Id');
  const name = stringAt(company, 'CompanyName');
  if (id && id !== realmId) throw new ConnectorIdentityError('credential_invalid', false);
  return id && name ? boundedIdentity(id, name) : null;
}

type IdentityResolver = (token: ConnectorToken, realmId: string | null,
  options: ConnectorReadOptions) => Promise<ConnectorIdentity | null>;

const RESOLVERS: Readonly<Record<OAuthConnectorKey, IdentityResolver>> = {
  'google-suite': (token, _realmId, options) => googleIdentity(token, options),
  youtube: (token, _realmId, options) => youtubeIdentity(token, options),
  stripe: (token, _realmId, options) => stripeIdentity(token, options),
  slack: (token, _realmId, options) => slackIdentity(token, options),
  'meta-business-suite': (token, _realmId, options) => metaIdentity(token, options),
  tiktok: (token, _realmId, options) => tiktokIdentity(token, options),
  'quickbooks-online': (token, realmId, options) => quickbooksIdentity(token, realmId, options),
};

export async function verifyConnectorIdentity(
  key: OAuthConnectorKey,
  token: ConnectorToken,
  realmId: string | null,
  options: ConnectorReadOptions = {},
): Promise<ConnectorIdentity> {
  const resolver = RESOLVERS[key];
  if (!resolver) throw new ConnectorIdentityError();
  const resolved = await resolver(token, realmId, options);
  if (!resolved) throw new ConnectorIdentityError();
  return resolved;
}

export async function verifyConnectorCleanupIdentity(
  key: OAuthConnectorKey,
  token: ConnectorToken,
  realmId: string | null,
  options: ConnectorReadOptions = {},
): Promise<ConnectorIdentity> {
  const resolver = key === 'google-suite' || key === 'youtube'
    ? googleGrantIdentity
    : key === 'slack'
      ? (
        credential: ConnectorToken,
        _realmId: string | null,
        readOptions: ConnectorReadOptions,
      ) => slackIdentity(credential, readOptions, false)
      : key === 'tiktok'
        ? (
          credential: ConnectorToken,
          _realmId: string | null,
          readOptions: ConnectorReadOptions,
        ) => tiktokIdentity(credential, readOptions, false)
      : RESOLVERS[key];
  const resolved = await resolver(token, realmId, options);
  if (!resolved) throw new ConnectorIdentityError('payload', true);
  return resolved;
}
