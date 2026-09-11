import { fetchExternalWithRetry } from '@platform/engine';

import { objectAt, stringAt, type ConnectorToken } from './connector-oauth-exchange';
import type { OAuthConnectorKey } from './connector-oauth-config';

export type ConnectorIdentity = {
  readonly accountId: string;
  readonly accountLabel: string;
};

const FAILED = 'Connector identity verification failed.';

/** Raised so the callback can name the identity stage rather than guess storage. */
export class ConnectorIdentityError extends Error {
  constructor() {
    super(FAILED);
    this.name = 'ConnectorIdentityError';
  }
}
const MAX_ACCOUNT_ID = 256;
const MAX_ACCOUNT_LABEL = 160;

type ConnectorReadOptions = {
  readonly timeoutMs?: number;
  readonly retryDelayMs?: number;
};

/**
 * Bounds a provider-supplied identity before it reaches the database and the UI.
 *
 * `external_account_label` is capped at 160 characters by its column, and these
 * values come from the same untrusted response as the token, so they get the same
 * treatment: trimmed, collapsed, and length-checked rather than passed through.
 */
function boundedIdentity(accountId: string, accountLabel: string): ConnectorIdentity | null {
  const id = accountId.trim();
  const label = accountLabel.replace(/\s+/gu, ' ').trim();
  if (!id || id.length > MAX_ACCOUNT_ID || !label) return null;
  return { accountId: id, accountLabel: label.slice(0, MAX_ACCOUNT_LABEL) };
}

async function identityJson(
  url: string,
  accessToken: string,
  options: ConnectorReadOptions,
): Promise<unknown> {
  const response = await fetchExternalWithRetry(url, {
    headers: { Accept: 'application/json', Authorization: `Bearer ${accessToken}` },
  }, { maxResponseBytes: 262_144, ...options });
  if (!response.ok) throw new ConnectorIdentityError();
  try {
    return await response.json();
  } catch {
    throw new ConnectorIdentityError();
  }
}

async function googleIdentity(
  token: ConnectorToken, options: ConnectorReadOptions,
): Promise<ConnectorIdentity | null> {
  const identity = await identityJson(
    'https://openidconnect.googleapis.com/v1/userinfo', token.access_token, options,
  );
  const id = stringAt(identity, 'sub');
  const email = stringAt(identity, 'email');
  return id && email ? boundedIdentity(id, email) : null;
}

async function youtubeIdentity(
  token: ConnectorToken, options: ConnectorReadOptions,
): Promise<ConnectorIdentity | null> {
  const identity = await identityJson(
    'https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true',
    token.access_token, options,
  );
  const items = Reflect.get(identity ?? {}, 'items');
  const channel = Array.isArray(items) ? items[0] as unknown : undefined;
  const id = stringAt(channel, 'id');
  const title = stringAt(objectAt(channel, 'snippet'), 'title');
  return id ? boundedIdentity(id, title ?? id) : null;
}

async function stripeIdentity(
  token: ConnectorToken, options: ConnectorReadOptions,
): Promise<ConnectorIdentity | null> {
  const account = await identityJson(
    'https://api.stripe.com/v1/account', token.access_token, options,
  );
  const id = stringAt(account, 'id');
  return id ? boundedIdentity(id, stringAt(account, 'display_name') ?? id) : null;
}

async function slackIdentity(
  token: ConnectorToken, options: ConnectorReadOptions,
): Promise<ConnectorIdentity | null> {
  const identity = await identityJson('https://slack.com/api/auth.test', token.access_token, options);
  const id = stringAt(identity, 'team_id');
  const name = stringAt(identity, 'team');
  const ok = Reflect.get(identity ?? {}, 'ok') === true;
  return ok && id && name ? boundedIdentity(id, name) : null;
}

async function metaIdentity(
  token: ConnectorToken, options: ConnectorReadOptions,
): Promise<ConnectorIdentity | null> {
  const account = await identityJson(
    'https://graph.facebook.com/v25.0/me?fields=id,name', token.access_token, options,
  );
  const id = stringAt(account, 'id');
  return id ? boundedIdentity(id, stringAt(account, 'name') ?? id) : null;
}

async function tiktokIdentity(
  token: ConnectorToken, options: ConnectorReadOptions,
): Promise<ConnectorIdentity | null> {
  const identity = await identityJson(
    'https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name',
    token.access_token, options,
  );
  const user = objectAt(objectAt(identity, 'data'), 'user');
  const id = stringAt(user, 'open_id');
  return id ? boundedIdentity(id, stringAt(user, 'display_name') ?? id) : null;
}

async function quickbooksIdentity(
  token: ConnectorToken,
  realmId: string | null,
  options: ConnectorReadOptions,
): Promise<ConnectorIdentity | null> {
  if (!realmId || !/^\d{1,32}$/.test(realmId)) return null;
  const sandbox = process.env.QUICKBOOKS_ENV?.trim() !== 'production';
  const host = sandbox ? 'sandbox-quickbooks.api.intuit.com' : 'quickbooks.api.intuit.com';
  const identity = await identityJson(
    `https://${host}/v3/company/${realmId}/companyinfo/${realmId}?minorversion=75`,
    token.access_token, options,
  );
  const company = objectAt(identity, 'CompanyInfo');
  const id = stringAt(company, 'Id');
  const name = stringAt(company, 'CompanyName');
  return id && name ? boundedIdentity(id, name) : null;
}

type IdentityResolver = (
  token: ConnectorToken,
  realmId: string | null,
  options: ConnectorReadOptions,
) => Promise<ConnectorIdentity | null>;

/**
 * One resolver per provider.
 *
 * A `Record` keyed on `OAuthConnectorKey` rather than a ternary chain, so adding
 * a connector key without a resolver is a compile error. A chain ending in a bare
 * `else` would instead send the new provider's token to Intuit.
 */
const RESOLVERS: Readonly<Record<OAuthConnectorKey, IdentityResolver>> = {
  'google-suite': (token, _realmId, options) => googleIdentity(token, options),
  youtube: (token, _realmId, options) => youtubeIdentity(token, options),
  stripe: (token, _realmId, options) => stripeIdentity(token, options),
  slack: (token, _realmId, options) => slackIdentity(token, options),
  'meta-business-suite': (token, _realmId, options) => metaIdentity(token, options),
  tiktok: (token, _realmId, options) => tiktokIdentity(token, options),
  'quickbooks-online': (token, realmId, options) => quickbooksIdentity(token, realmId, options),
};

/** Confirms the freshly issued token really belongs to a nameable provider account. */
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
