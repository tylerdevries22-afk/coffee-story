import { fetchWithRetry } from '@platform/api-client';

import { objectAt, stringAt, type ConnectorToken } from './connector-oauth-exchange';
import type { OAuthConnectorKey } from './connector-oauth-config';

export type ConnectorIdentity = {
  readonly accountId: string;
  readonly accountLabel: string;
};

const FAILED = 'Connector identity verification failed.';
const MAX_ACCOUNT_ID = 256;
const MAX_ACCOUNT_LABEL = 160;

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

async function identityJson(url: string, accessToken: string): Promise<unknown> {
  const response = await fetchWithRetry(url, {
    headers: { Accept: 'application/json', Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) throw new Error(FAILED);
  return response.json();
}

async function googleIdentity(token: ConnectorToken): Promise<ConnectorIdentity | null> {
  const identity = await identityJson('https://openidconnect.googleapis.com/v1/userinfo', token.access_token);
  const id = stringAt(identity, 'sub');
  const email = stringAt(identity, 'email');
  return id && email ? boundedIdentity(id, email) : null;
}

async function youtubeIdentity(token: ConnectorToken): Promise<ConnectorIdentity | null> {
  const identity = await identityJson(
    'https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true',
    token.access_token,
  );
  const items = Reflect.get(identity ?? {}, 'items');
  const channel = Array.isArray(items) ? items[0] as unknown : undefined;
  const id = stringAt(channel, 'id');
  const title = stringAt(objectAt(channel, 'snippet'), 'title');
  return id ? boundedIdentity(id, title ?? id) : null;
}

async function stripeIdentity(token: ConnectorToken): Promise<ConnectorIdentity | null> {
  const account = await identityJson('https://api.stripe.com/v1/account', token.access_token);
  const id = stringAt(account, 'id');
  return id ? boundedIdentity(id, stringAt(account, 'display_name') ?? id) : null;
}

async function slackIdentity(token: ConnectorToken): Promise<ConnectorIdentity | null> {
  const identity = await identityJson('https://slack.com/api/auth.test', token.access_token);
  const id = stringAt(identity, 'team_id');
  const name = stringAt(identity, 'team');
  const ok = Reflect.get(identity ?? {}, 'ok') === true;
  return ok && id && name ? boundedIdentity(id, name) : null;
}

async function metaIdentity(token: ConnectorToken): Promise<ConnectorIdentity | null> {
  const account = await identityJson(
    'https://graph.facebook.com/v25.0/me?fields=id,name', token.access_token,
  );
  const id = stringAt(account, 'id');
  return id ? boundedIdentity(id, stringAt(account, 'name') ?? id) : null;
}

async function tiktokIdentity(token: ConnectorToken): Promise<ConnectorIdentity | null> {
  const identity = await identityJson(
    'https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name',
    token.access_token,
  );
  const user = objectAt(objectAt(identity, 'data'), 'user');
  const id = stringAt(user, 'open_id');
  return id ? boundedIdentity(id, stringAt(user, 'display_name') ?? id) : null;
}

async function quickbooksIdentity(
  token: ConnectorToken,
  realmId: string | null,
): Promise<ConnectorIdentity | null> {
  if (!realmId || !/^\d{1,32}$/.test(realmId)) return null;
  const sandbox = process.env.QUICKBOOKS_ENV?.trim() !== 'production';
  const host = sandbox ? 'sandbox-quickbooks.api.intuit.com' : 'quickbooks.api.intuit.com';
  const identity = await identityJson(
    `https://${host}/v3/company/${realmId}/companyinfo/${realmId}?minorversion=75`,
    token.access_token,
  );
  const company = objectAt(identity, 'CompanyInfo');
  const id = stringAt(company, 'Id');
  const name = stringAt(company, 'CompanyName');
  return id && name ? boundedIdentity(id, name) : null;
}

type IdentityResolver = (
  token: ConnectorToken,
  realmId: string | null,
) => Promise<ConnectorIdentity | null>;

/**
 * One resolver per provider.
 *
 * A `Record` keyed on `OAuthConnectorKey` rather than a ternary chain, so adding
 * a connector key without a resolver is a compile error. A chain ending in a bare
 * `else` would instead send the new provider's token to Intuit.
 */
const RESOLVERS: Readonly<Record<OAuthConnectorKey, IdentityResolver>> = {
  'google-suite': (token) => googleIdentity(token),
  youtube: (token) => youtubeIdentity(token),
  stripe: (token) => stripeIdentity(token),
  slack: (token) => slackIdentity(token),
  'meta-business-suite': (token) => metaIdentity(token),
  tiktok: (token) => tiktokIdentity(token),
  'quickbooks-online': (token, realmId) => quickbooksIdentity(token, realmId),
};

/** Confirms the freshly issued token really belongs to a nameable provider account. */
export async function verifyConnectorIdentity(
  key: OAuthConnectorKey,
  token: ConnectorToken,
  realmId: string | null,
): Promise<ConnectorIdentity> {
  const resolver = RESOLVERS[key];
  if (!resolver) throw new Error(FAILED);
  const resolved = await resolver(token, realmId);
  if (!resolved) throw new Error(FAILED);
  return resolved;
}
