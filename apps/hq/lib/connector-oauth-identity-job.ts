import type { SupabaseClient } from '@supabase/supabase-js';

import { isOAuthConnectorKey, type OAuthConnectorKey } from './connector-oauth-config';
import { stringAt, type ConnectorToken } from './connector-oauth-exchange';
import { parseConnectorIdentityHint, type ConnectorIdentityHint } from './connector-oauth-identity-hint';
import { ConnectorOAuthJobError } from './connector-oauth-job-contract';
import { connectorRpc } from './connector-rpc';
import {
  connectorUtf8Bytes,
  isBoundedConnectorCleanupCredential,
  isBoundedConnectorToken,
} from './connector-oauth-token-bounds';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const CLAIM_LIMIT = 2;
const LEASE_SECONDS = 600;

export type ConnectorOAuthIdentityJob = Readonly<{
  jobId: string;
  brandId: string;
  installationId: string;
  credentialReferenceId: string;
  providerKey: OAuthConnectorKey;
  credentialGeneration: number | string;
  leaseToken: string;
  credential: ConnectorToken;
  expiresAt: string | null;
  grantedScopes: readonly string[];
  identityHint: ConnectorIdentityHint;
}>;

export type ConnectorOAuthIdentityClaim = ConnectorOAuthIdentityJob | Readonly<{
  jobId: string;
  leaseToken: string;
  invalidCode: 'identity_contract_invalid';
}>;

function uuidAt(row: object, key: string): string | null {
  const value = Reflect.get(row, key);
  return typeof value === 'string' && UUID.test(value) ? value : null;
}

function generationAt(row: object): number | string | null {
  const value = Reflect.get(row, 'credential_generation');
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return value;
  return typeof value === 'string' && /^(0|[1-9][0-9]{0,18})$/u.test(value) ? value : null;
}

function parseIdentityJob(raw: unknown): ConnectorOAuthIdentityClaim | null {
  if (!raw || typeof raw !== 'object') return null;
  const jobId = uuidAt(raw, 'job_id');
  const leaseToken = uuidAt(raw, 'lease_token');
  if (!jobId || !leaseToken) return null;
  const brandId = uuidAt(raw, 'brand_id');
  const installationId = uuidAt(raw, 'installation_id');
  const credentialReferenceId = uuidAt(raw, 'credential_reference_id');
  const credentialGeneration = generationAt(raw);
  const providerKey = Reflect.get(raw, 'provider_key');
  const credential = Reflect.get(raw, 'credential');
  const accessToken = stringAt(credential, 'access_token');
  const expiresAt = Reflect.get(raw, 'expires_at');
  const scopes = Reflect.get(raw, 'granted_scopes');
  const identityHint = isOAuthConnectorKey(providerKey)
    ? parseConnectorIdentityHint(providerKey, Reflect.get(raw, 'identity_hint')) : null;
  if (!brandId || !installationId || !credentialReferenceId
    || credentialGeneration === null || !isOAuthConnectorKey(providerKey)
    || !credential || typeof credential !== 'object'
    || !isBoundedConnectorToken(accessToken)
    || !isBoundedConnectorCleanupCredential(credential) || !identityHint
    || (expiresAt !== null && (typeof expiresAt !== 'string'
      || !Number.isFinite(Date.parse(expiresAt))))
    || !Array.isArray(scopes) || scopes.length > 32
    || scopes.some((scope) => typeof scope !== 'string' || !scope
      || scope.trim() !== scope || connectorUtf8Bytes(scope) > 512)) {
    return { jobId, leaseToken, invalidCode: 'identity_contract_invalid' };
  }
  return {
    jobId, brandId, installationId, credentialReferenceId, providerKey,
    credentialGeneration, leaseToken, credential: credential as ConnectorToken,
    expiresAt: expiresAt as string | null,
    grantedScopes: [...new Set(scopes as string[])], identityHint,
  };
}

export async function claimConnectorOAuthIdentityJobs(
  db: SupabaseClient,
  now: Date,
): Promise<readonly ConnectorOAuthIdentityClaim[]> {
  try {
    const result = await connectorRpc(db, 'claim_connector_oauth_identities', {
      p_now: now.toISOString(), p_limit: CLAIM_LIMIT, p_lease_seconds: LEASE_SECONDS,
    });
    if (result.error || !Array.isArray(result.data)) throw new ConnectorOAuthJobError('claim');
    const jobs = result.data.map(parseIdentityJob);
    if (jobs.some((job) => !job)) throw new ConnectorOAuthJobError('claim');
    return jobs as readonly ConnectorOAuthIdentityClaim[];
  } catch (error) {
    if (error instanceof ConnectorOAuthJobError) throw error;
    throw new ConnectorOAuthJobError('claim');
  }
}
