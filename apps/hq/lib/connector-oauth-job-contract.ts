import type { SupabaseClient } from '@supabase/supabase-js';

import { isOAuthConnectorKey, type OAuthConnectorKey } from './connector-oauth-config';
import { stringAt, type ConnectorToken } from './connector-oauth-exchange';
import { connectorRpc } from './connector-rpc';
import {
  connectorUtf8Bytes,
  isBoundedConnectorCredential,
  isBoundedConnectorCleanupCredential,
  isBoundedConnectorIdentity,
  isBoundedConnectorToken,
} from './connector-oauth-token-bounds';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const REFRESHABLE = new Set<OAuthConnectorKey>([
  'google-suite', 'youtube', 'quickbooks-online', 'slack', 'tiktok',
]);
const GRANT_SCOPED_REVOCATION = new Set<OAuthConnectorKey>([
  'google-suite', 'youtube', 'stripe', 'quickbooks-online', 'slack',
  'meta-business-suite', 'tiktok',
]);
// Two serial jobs leave ample margin inside the 300-second cron budget.
const CLAIM_LIMIT = 2;
const LEASE_SECONDS = 600;

export class ConnectorOAuthJobError extends Error {
  constructor(readonly stage: 'claim' | 'settlement') {
    super(`Connector OAuth ${stage} failed.`);
    this.name = 'ConnectorOAuthJobError';
  }
}

export class ConnectorOAuthLeaseLostError extends Error {
  constructor() {
    super('Connector OAuth lease is no longer current.');
    this.name = 'ConnectorOAuthLeaseLostError';
  }
}

export class ConnectorOAuthRotationStartError extends Error {
  constructor() {
    super('Connector OAuth rotation did not start.');
    this.name = 'ConnectorOAuthRotationStartError';
  }
}

export type ConnectorOAuthJob = Readonly<{
  jobId: string;
  brandId: string;
  installationId: string;
  credentialReferenceId: string;
  providerKey: OAuthConnectorKey;
  credentialGeneration: number | string;
  leaseToken: string;
  credential: ConnectorToken;
  accountLabel: string;
  expiresAt: string | null;
  grantedScopes: readonly string[];
}>;

export type ConnectorOAuthPoisonedJob = Readonly<{
  jobId: string;
  leaseToken: string;
  invalidCode: 'credential_contract_invalid';
}>;

export type ConnectorOAuthClaim = ConnectorOAuthJob | ConnectorOAuthPoisonedJob;

function uuidAt(row: object, key: string): string | null {
  const value = Reflect.get(row, key);
  return typeof value === 'string' && UUID.test(value) ? value : null;
}

function generationAt(row: object): number | string | null {
  const value = Reflect.get(row, 'credential_generation');
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return value;
  return typeof value === 'string' && /^(0|[1-9][0-9]{0,18})$/u.test(value) ? value : null;
}

function parseJob(raw: unknown, kind: 'refresh' | 'revocation'): ConnectorOAuthClaim | null {
  if (!raw || typeof raw !== 'object') return null;
  const jobId = uuidAt(raw, 'job_id');
  const leaseToken = uuidAt(raw, 'lease_token');
  if (!jobId || !leaseToken) return null;
  const brandId = uuidAt(raw, 'brand_id');
  const installationId = uuidAt(raw, 'installation_id');
  const credentialReferenceId = uuidAt(raw, 'credential_reference_id');
  const generation = generationAt(raw);
  const provider = Reflect.get(raw, 'provider_key');
  const rawCredential = Reflect.get(raw, 'credential');
  const rawRefreshToken = rawCredential && typeof rawCredential === 'object'
    ? Reflect.get(rawCredential, 'refresh_token') : undefined;
  const malformedOptionalRefresh = kind === 'revocation'
    && rawRefreshToken !== null && rawRefreshToken !== undefined
    && !isBoundedConnectorToken(typeof rawRefreshToken === 'string' ? rawRefreshToken : null);
  const credential = malformedOptionalRefresh && rawCredential && typeof rawCredential === 'object'
    ? Object.fromEntries(Object.entries(rawCredential).filter(([key]) => key !== 'refresh_token'))
    : rawCredential;
  const accessToken = stringAt(credential, 'access_token');
  const refreshToken = stringAt(credential, 'refresh_token');
  const externalAccountId = stringAt(credential, 'external_account_id');
  const accountLabel = Reflect.get(raw, 'account_label');
  const scopes = Reflect.get(raw, 'granted_scopes');
  const identityRequired = kind === 'refresh' || (isOAuthConnectorKey(provider)
    && GRANT_SCOPED_REVOCATION.has(provider));
  if (!brandId || !installationId || !credentialReferenceId
    || generation === null || !isOAuthConnectorKey(provider)
    || (kind === 'refresh' && !REFRESHABLE.has(provider))
    || !credential || typeof credential !== 'object' || !isBoundedConnectorToken(accessToken)
    || (identityRequired && !isBoundedConnectorIdentity(externalAccountId))
    || (kind === 'refresh' && !isBoundedConnectorToken(refreshToken))
    || !(kind === 'revocation'
      ? isBoundedConnectorCleanupCredential(credential)
      : isBoundedConnectorCredential(credential))
    || typeof accountLabel !== 'string' || accountLabel.length > 500
    || (kind === 'refresh' && (!Array.isArray(scopes) || scopes.length > 32
      || scopes.some((scope) => typeof scope !== 'string' || !scope
        || connectorUtf8Bytes(scope) > 512)))) {
    return { jobId, leaseToken, invalidCode: 'credential_contract_invalid' };
  }
  const expires = Reflect.get(raw, 'expires_at');
  if (expires !== null && expires !== undefined
    && (typeof expires !== 'string' || !Number.isFinite(Date.parse(expires)))) {
    return { jobId, leaseToken, invalidCode: 'credential_contract_invalid' };
  }
  return {
    jobId, brandId, installationId, credentialReferenceId,
    providerKey: provider, credentialGeneration: generation, leaseToken,
    credential: credential as ConnectorToken, accountLabel,
    expiresAt: typeof expires === 'string' ? expires : null,
    grantedScopes: Array.isArray(scopes) ? [...new Set(scopes as string[])] : [],
  };
}

export async function claimConnectorOAuthJobs(
  db: SupabaseClient,
  kind: 'refresh' | 'revocation',
  now: Date,
): Promise<readonly ConnectorOAuthClaim[]> {
  try {
    const result = await connectorRpc(db, `claim_connector_oauth_${kind === 'refresh' ? 'refreshes' : 'revocations'}`, {
      p_now: now.toISOString(), p_limit: CLAIM_LIMIT, p_lease_seconds: LEASE_SECONDS,
    });
    if (result.error || !Array.isArray(result.data)) throw new ConnectorOAuthJobError('claim');
    const jobs = result.data.map((row) => parseJob(row, kind));
    if (jobs.some((job) => !job)) throw new ConnectorOAuthJobError('claim');
    return jobs as readonly ConnectorOAuthClaim[];
  } catch (error) {
    if (error instanceof ConnectorOAuthJobError) throw error;
    throw new ConnectorOAuthJobError('claim');
  }
}

export async function settleConnectorOAuthJob(
  db: SupabaseClient,
  name: string,
  args: Readonly<Record<string, unknown>>,
): Promise<boolean> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const result = await connectorRpc(db, name, args);
      if (!result.error && result.data === true) return true;
      if (!result.error && result.data === false) return false;
    } catch { /* same-lease replay is idempotent */ }
  }
  throw new ConnectorOAuthJobError('settlement');
}

export async function startConnectorOAuthCredentialRotation(
  db: SupabaseClient,
  job: Pick<ConnectorOAuthClaim, 'jobId' | 'leaseToken'>,
  now: Date,
): Promise<void> {
  const args = { p_job_id: job.jobId, p_lease_token: job.leaseToken, p_now: now.toISOString() };
  let current: boolean;
  try {
    current = await settleConnectorOAuthJob(db, 'start_connector_oauth_credential_rotation', args);
  } catch {
    const cancelled = await settleConnectorOAuthJob(
      db, 'cancel_connector_oauth_credential_rotation', args,
    );
    if (!cancelled) throw new ConnectorOAuthLeaseLostError();
    throw new ConnectorOAuthRotationStartError();
  }
  if (!current) throw new ConnectorOAuthLeaseLostError();
}
