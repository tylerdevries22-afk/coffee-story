import type { SupabaseClient } from '@supabase/supabase-js';

import { connectorTokenExpiryAt } from './connector-oauth-callback-contract';
import { connectorCredentialExpiresWithin } from './connector-oauth-credential-expiry';
import {
  ConnectorExchangeError,
  extendMetaConnectorToken,
  stringAt,
  type ConnectorToken,
} from './connector-oauth-exchange';
import type { ConnectorOAuthIdentityJob } from './connector-oauth-identity-job';
import {
  ConnectorOAuthLeaseLostError,
  settleConnectorOAuthJob,
  startConnectorOAuthCredentialRotation,
} from './connector-oauth-job-contract';
import { ConnectorRefreshError, refreshConnectorToken } from './connector-oauth-refresh';
import { connectorRefreshGrantedScopes } from './connector-oauth-refresh-scopes';
import {
  connectorCredentialBytes,
  isBoundedConnectorCleanupCredential,
} from './connector-oauth-token-bounds';

const EXPIRY_MARGIN_MS = 60_000;
const META_SHORT_TOKEN_MS = 2 * 24 * 60 * 60 * 1_000;

export function connectorIdentityCredentialNeedsRotation(
  job: ConnectorOAuthIdentityJob,
  now: Date,
): boolean {
  return connectorCredentialExpiresWithin(
    job.credential, job.expiresAt, now,
    job.providerKey === 'meta-business-suite' ? META_SHORT_TOKEN_MS : EXPIRY_MARGIN_MS,
  );
}

export function canRotateConnectorIdentityCredential(job: ConnectorOAuthIdentityJob): boolean {
  return job.providerKey === 'meta-business-suite'
    || Boolean(stringAt(job.credential, 'refresh_token'));
}

function metaRefreshError(error: unknown): ConnectorRefreshError {
  if (!(error instanceof ConnectorExchangeError)) {
    return new ConnectorRefreshError('transport', null, 'transport', true);
  }
  if (error.stage === 'unconfigured') {
    return new ConnectorRefreshError('unconfigured', null, 'configuration_unavailable', true);
  }
  const transient = error.stage === 'transport' || error.stage === 'payload'
    || error.status === 429 || (error.status !== null && error.status >= 500);
  return new ConnectorRefreshError(
    error.stage === 'provider' ? 'provider' : 'payload', error.status,
    transient ? 'provider_rejected' : 'invalid_grant', transient,
  );
}

export async function rotateConnectorIdentityCredential(
  db: SupabaseClient,
  job: ConnectorOAuthIdentityJob,
  now: Date,
): Promise<ConnectorToken> {
  const beforeRequest = () => startConnectorOAuthCredentialRotation(db, job, now);
  let credential: ConnectorToken | null;
  if (job.providerKey === 'meta-business-suite') {
    try {
      credential = await extendMetaConnectorToken(job.credential, undefined, beforeRequest);
    } catch (error) { throw metaRefreshError(error); }
  } else {
    const scopeReserve = connectorCredentialBytes({ granted_scopes: job.grantedScopes });
    if (scopeReserve === null) {
      throw new ConnectorRefreshError('payload', null, 'credential_contract_invalid', false);
    }
    credential = await refreshConnectorToken(
      job.providerKey, job.credential, undefined, scopeReserve, beforeRequest,
    );
  }
  if (!credential) throw new ConnectorRefreshError('unsupported', null, 'provider_rejected', false);
  const grantedScopes = job.providerKey === 'meta-business-suite'
    ? job.grantedScopes
    : connectorRefreshGrantedScopes(job.providerKey, credential, job.grantedScopes);
  const settled = { ...credential, granted_scopes: grantedScopes };
  if (!isBoundedConnectorCleanupCredential(settled)) {
    throw new ConnectorRefreshError('payload', null, 'credential_contract_invalid', false);
  }
  const accepted = await settleConnectorOAuthJob(db, 'rotate_connector_oauth_identity_credential', {
    p_job_id: job.jobId, p_lease_token: job.leaseToken, p_credential: settled,
    p_expires_at: connectorTokenExpiryAt(job.providerKey, credential, now),
    p_now: now.toISOString(),
  });
  if (!accepted) throw new ConnectorOAuthLeaseLostError();
  return credential;
}
