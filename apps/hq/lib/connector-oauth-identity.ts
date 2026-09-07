import { fetchWithRetry } from '@platform/api-client';

import { objectAt, stringAt, type ConnectorToken } from './connector-oauth-exchange';
import type { OAuthConnectorKey } from './connector-oauth-config';

export type ConnectorIdentity = {
  readonly accountId: string;
  readonly accountLabel: string;
};

const FAILED = 'Connector identity verification failed.';

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
  return id && email ? { accountId: id, accountLabel: email } : null;
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
  return id ? { accountId: id, accountLabel: title ?? id } : null;
}

async function stripeIdentity(token: ConnectorToken): Promise<ConnectorIdentity | null> {
  const identity = await identityJson('https://api.stripe.com/v1/account', token.access_token);
  const id = stringAt(identity, 'id');
  return id ? { accountId: id, accountLabel: stringAt(identity, 'display_name') ?? id } : null;
}

async function slackIdentity(token: ConnectorToken): Promise<ConnectorIdentity | null> {
  const identity = await identityJson('https://slack.com/api/auth.test', token.access_token);
  const id = stringAt(identity, 'team_id');
  const name = stringAt(identity, 'team');
  const ok = Reflect.get(identity ?? {}, 'ok') === true;
  return ok && id && name ? { accountId: id, accountLabel: name } : null;
}

async function metaIdentity(token: ConnectorToken): Promise<ConnectorIdentity | null> {
  const identity = await identityJson(
    'https://graph.facebook.com/v25.0/me?fields=id,name', token.access_token,
  );
  const id = stringAt(identity, 'id');
  return id ? { accountId: id, accountLabel: stringAt(identity, 'name') ?? id } : null;
}

async function tiktokIdentity(token: ConnectorToken): Promise<ConnectorIdentity | null> {
  const identity = await identityJson(
    'https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name',
    token.access_token,
  );
  const user = objectAt(objectAt(identity, 'data'), 'user');
  const id = stringAt(user, 'open_id');
  return id ? { accountId: id, accountLabel: stringAt(user, 'display_name') ?? id } : null;
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
  return id && name ? { accountId: id, accountLabel: name } : null;
}

/** Confirms the freshly issued token really belongs to a nameable provider account. */
export async function verifyConnectorIdentity(
  key: OAuthConnectorKey,
  token: ConnectorToken,
  realmId: string | null,
): Promise<ConnectorIdentity> {
  const identity = key === 'google-suite' ? await googleIdentity(token)
    : key === 'youtube' ? await youtubeIdentity(token)
    : key === 'stripe' ? await stripeIdentity(token)
    : key === 'slack' ? await slackIdentity(token)
    : key === 'meta-business-suite' ? await metaIdentity(token)
    : key === 'tiktok' ? await tiktokIdentity(token)
    : await quickbooksIdentity(token, realmId);
  if (!identity) throw new Error(FAILED);
  return identity;
}
