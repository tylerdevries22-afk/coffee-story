import type { SupabaseClient } from '@supabase/supabase-js';

import { stringAt, type ConnectorToken } from './connector-oauth-exchange';
import { connectorCredentialExpiresWithin } from './connector-oauth-credential-expiry';
import {
  claimConnectorOAuthJobs,
  ConnectorOAuthJobError,
  ConnectorOAuthLeaseLostError,
  ConnectorOAuthRotationStartError,
  settleConnectorOAuthJob,
  startConnectorOAuthCredentialRotation,
  type ConnectorOAuthClaim,
  type ConnectorOAuthJob,
} from './connector-oauth-job-contract';
import { ConnectorRefreshError, connectorTokenExpiry, refreshConnectorToken } from './connector-oauth-refresh';
import { connectorRefreshGrantedScopes } from './connector-oauth-refresh-scopes';
import { revokeConnectorTokenDetailed } from './connector-oauth-revoke';
import { settleIssuedConnectorRotationFailure } from './connector-oauth-rotation-failure';
import { connectorCredentialBytes, isBoundedConnectorCredential } from './connector-oauth-token-bounds';

export type ConnectorOAuthMaintenanceResult = Readonly<{
  claimed: number; completed: number; failed: number; stale: number;
}>;

type MutableResult = { claimed: number; completed: number; failed: number; stale: number };

async function settle(
  db: SupabaseClient,
  name: string,
  job: Pick<ConnectorOAuthClaim, 'jobId' | 'leaseToken'>,
  now: Date,
  extra: Readonly<Record<string, unknown>> = {},
): Promise<boolean> {
  return settleConnectorOAuthJob(db, name, {
    p_job_id: job.jobId, p_lease_token: job.leaseToken, p_now: now.toISOString(), ...extra,
  });
}

async function fail(
  db: SupabaseClient,
  kind: 'refresh' | 'revocation',
  job: Pick<ConnectorOAuthClaim, 'jobId' | 'leaseToken'>,
  now: Date,
  code: string,
  retryable: boolean,
): Promise<boolean> {
  return settle(db, `fail_connector_oauth_${kind}`, job, now, {
    p_error_code: code, p_retryable: retryable,
  });
}

async function refreshForRevocation(
  db: SupabaseClient,
  job: ConnectorOAuthJob,
  now: Date,
): Promise<ConnectorToken> {
  const next = await refreshConnectorToken(
    job.providerKey, job.credential, undefined, 0,
    () => startConnectorOAuthCredentialRotation(db, job, now),
  );
  if (!next) throw new ConnectorRefreshError('unsupported', null, 'provider_rejected', false);
  return next;
}

async function rotateRevocationCredential(
  db: SupabaseClient,
  job: ConnectorOAuthJob,
  now: Date,
): Promise<ConnectorToken | null> {
  const credential = await refreshForRevocation(db, job, now);
  const persisted = await settle(
    db, 'rotate_connector_oauth_revocation_credential', job, now,
    { p_credential: credential,
      p_expires_at: connectorTokenExpiry(credential, now) },
  );
  return persisted ? credential : null;
}

async function processRevocation(
  db: SupabaseClient,
  job: ConnectorOAuthJob,
  now: Date,
): Promise<'completed' | 'failed' | 'stale'> {
  let credential = job.credential;
  let refreshed = false;
  try {
    if ((job.providerKey === 'slack' || job.providerKey === 'tiktok')
      && stringAt(credential, 'refresh_token')
      && connectorCredentialExpiresWithin(credential, job.expiresAt, now, 60_000)) {
      const rotated = await rotateRevocationCredential(db, job, now);
      if (!rotated) return 'stale';
      credential = rotated;
      refreshed = true;
    }
    let result = await revokeConnectorTokenDetailed(
      job.providerKey, credential, stringAt(credential, 'external_account_id') ?? undefined,
    );
    if ((job.providerKey === 'slack' || job.providerKey === 'tiktok')
      && result.code === 'credential_invalid'
      && !refreshed && stringAt(credential, 'refresh_token')) {
      const rotated = await rotateRevocationCredential(db, job, now);
      if (!rotated) return 'stale';
      credential = rotated;
      result = await revokeConnectorTokenDetailed(job.providerKey, credential);
    }
    const accepted = result.revoked
      ? await settle(db, 'complete_connector_oauth_revocation', job, now)
      : await fail(db, 'revocation', job, now, result.code, result.retryable);
    return accepted ? result.revoked ? 'completed' : 'failed' : 'stale';
  } catch (error) {
    if (error instanceof ConnectorOAuthLeaseLostError) return 'stale';
    if (error instanceof ConnectorOAuthRotationStartError) {
      return await fail(db, 'revocation', job, now, 'rotation_not_started', true)
        ? 'failed' : 'stale';
    }
    if (error instanceof ConnectorOAuthJobError) throw error;
    const escrowed = await settleIssuedConnectorRotationFailure(db, job, now, error);
    if (escrowed) return escrowed;
    const code = error instanceof ConnectorRefreshError ? error.code : 'transport';
    const retryable = error instanceof ConnectorRefreshError && error.retryable;
    return await fail(db, 'revocation', job, now, code, retryable) ? 'failed' : 'stale';
  }
}

async function processRefresh(
  db: SupabaseClient,
  job: ConnectorOAuthJob,
  now: Date,
): Promise<'completed' | 'failed' | 'stale'> {
  try {
    const scopeReserve = connectorCredentialBytes({ granted_scopes: job.grantedScopes });
    if (scopeReserve === null) {
      return await fail(db, 'refresh', job, now, 'credential_contract_invalid', false)
        ? 'failed' : 'stale';
    }
    const credential = await refreshConnectorToken(
      job.providerKey, job.credential, undefined, scopeReserve,
      () => startConnectorOAuthCredentialRotation(db, job, now),
    );
    if (!credential) {
      return await fail(db, 'refresh', job, now, 'refresh_unsupported', false) ? 'failed' : 'stale';
    }
    const grantedScopes = connectorRefreshGrantedScopes(
      job.providerKey, credential, job.grantedScopes,
    );
    const settledCredential = { ...credential, granted_scopes: grantedScopes };
    if (!isBoundedConnectorCredential(settledCredential)) {
      return await fail(db, 'refresh', job, now, 'credential_contract_invalid', false)
        ? 'failed' : 'stale';
    }
    const accepted = await settle(db, 'complete_connector_oauth_refresh', job, now, {
      p_credential: settledCredential,
      p_expires_at: connectorTokenExpiry(credential, now),
    });
    return accepted ? 'completed' : 'stale';
  } catch (error) {
    if (error instanceof ConnectorOAuthLeaseLostError) return 'stale';
    if (error instanceof ConnectorOAuthRotationStartError) {
      return await fail(db, 'refresh', job, now, 'rotation_not_started', true)
        ? 'failed' : 'stale';
    }
    if (error instanceof ConnectorOAuthJobError) throw error;
    const escrowed = await settleIssuedConnectorRotationFailure(db, job, now, error);
    if (escrowed) return escrowed;
    const code = error instanceof ConnectorRefreshError ? error.code : 'transport';
    const retryable = error instanceof ConnectorRefreshError && error.retryable;
    return await fail(db, 'refresh', job, now, code, retryable) ? 'failed' : 'stale';
  }
}

async function runJobs(
  db: SupabaseClient,
  kind: 'refresh' | 'revocation',
  now: Date,
): Promise<ConnectorOAuthMaintenanceResult> {
  const jobs = await claimConnectorOAuthJobs(db, kind, now);
  const result: MutableResult = { claimed: jobs.length, completed: 0, failed: 0, stale: 0 };
  let settlementFailed = false;
  for (const job of jobs) {
    try {
      const outcome = 'invalidCode' in job
        ? await fail(db, kind, job, now, job.invalidCode, false) ? 'failed' : 'stale'
        : kind === 'refresh'
          ? await processRefresh(db, job, now) : await processRevocation(db, job, now);
      result[outcome] += 1;
    } catch {
      settlementFailed = true;
    }
  }
  if (settlementFailed) throw new ConnectorOAuthJobError('settlement');
  return result;
}

export function runConnectorOAuthRefreshes(db: SupabaseClient, now: Date) {
  return runJobs(db, 'refresh', now); }

export function runConnectorOAuthRevocations(db: SupabaseClient, now: Date) {
  return runJobs(db, 'revocation', now); }
