import type { SupabaseClient } from '@supabase/supabase-js';

import { ExternalRequestError } from '@platform/engine';

import { ConnectorIdentityError, verifyConnectorCleanupIdentity } from './connector-oauth-identity';
import {
  claimConnectorOAuthIdentityJobs,
  type ConnectorOAuthIdentityClaim,
  type ConnectorOAuthIdentityJob,
} from './connector-oauth-identity-job';
import {
  canRotateConnectorIdentityCredential,
  connectorIdentityCredentialNeedsRotation,
  rotateConnectorIdentityCredential,
} from './connector-oauth-identity-rotation';
import {
  ConnectorOAuthJobError,
  ConnectorOAuthLeaseLostError,
  ConnectorOAuthRotationStartError,
  settleConnectorOAuthJob,
} from './connector-oauth-job-contract';
import { ConnectorRefreshError } from './connector-oauth-refresh';
import { settleIssuedConnectorRotationFailure } from './connector-oauth-rotation-failure';

export type ConnectorOAuthIdentityResult = Readonly<{
  claimed: number;
  completed: number;
  failed: number;
  stale: number;
}>;

async function settle(
  db: SupabaseClient,
  name: 'complete_connector_oauth_identity' | 'fail_connector_oauth_identity',
  job: Pick<ConnectorOAuthIdentityClaim, 'jobId' | 'leaseToken'>,
  now: Date,
  extra: Readonly<Record<string, unknown>>,
): Promise<boolean> {
  return settleConnectorOAuthJob(db, name, {
    p_job_id: job.jobId, p_lease_token: job.leaseToken,
    p_now: now.toISOString(), ...extra,
  });
}

async function fail(
  db: SupabaseClient,
  job: Pick<ConnectorOAuthIdentityClaim, 'jobId' | 'leaseToken'>,
  now: Date,
  code: string,
  retryable: boolean,
): Promise<boolean> {
  return settle(db, 'fail_connector_oauth_identity', job, now, {
    p_error_code: code, p_retryable: retryable,
  });
}

async function processIdentity(
  db: SupabaseClient,
  job: ConnectorOAuthIdentityJob,
  now: Date,
): Promise<'completed' | 'failed' | 'stale'> {
  try {
    let credential = job.credential;
    let rotated = false;
    if (connectorIdentityCredentialNeedsRotation(job, now)
      && canRotateConnectorIdentityCredential(job)) {
      credential = await rotateConnectorIdentityCredential(db, job, now);
      rotated = true;
    }
    let identity;
    try {
      identity = await verifyConnectorCleanupIdentity(
        job.providerKey, credential, job.identityHint.realmId ?? null,
      );
    } catch (error) {
      if (!(error instanceof ConnectorIdentityError)
        || error.code !== 'credential_invalid' || rotated
        || job.providerKey === 'meta-business-suite'
        || !canRotateConnectorIdentityCredential(job)) throw error;
      credential = await rotateConnectorIdentityCredential(db, job, now);
      identity = await verifyConnectorCleanupIdentity(
        job.providerKey, credential, job.identityHint.realmId ?? null,
      );
    }
    const accepted = await settle(db, 'complete_connector_oauth_identity', job, now, {
      p_external_account_id: identity.accountId,
    });
    return accepted ? 'completed' : 'stale';
  } catch (error) {
    if (error instanceof ConnectorOAuthLeaseLostError) return 'stale';
    if (error instanceof ConnectorOAuthRotationStartError) {
      return await fail(db, job, now, 'rotation_not_started', true) ? 'failed' : 'stale';
    }
    if (error instanceof ConnectorOAuthJobError) throw error;
    const escrowed = await settleIssuedConnectorRotationFailure(db, job, now, error);
    if (escrowed) return escrowed;
    if (error instanceof ConnectorRefreshError) {
      return await fail(db, job, now, error.code, error.retryable) ? 'failed' : 'stale';
    }
    const known = error instanceof ConnectorIdentityError;
    const retryable = known ? error.retryable : error instanceof ExternalRequestError;
    const code = known ? error.code
      : error instanceof ExternalRequestError ? 'identity_transport' : 'identity_failed';
    return await fail(db, job, now, code, retryable) ? 'failed' : 'stale';
  }
}

export async function runConnectorOAuthIdentities(
  db: SupabaseClient,
  now: Date,
): Promise<ConnectorOAuthIdentityResult> {
  const jobs = await claimConnectorOAuthIdentityJobs(db, now);
  const result = { claimed: jobs.length, completed: 0, failed: 0, stale: 0 };
  let settlementFailed = false;
  for (const job of jobs) {
    try {
      const outcome = 'invalidCode' in job
        ? await fail(db, job, now, job.invalidCode, false) ? 'failed' : 'stale'
        : await processIdentity(db, job, now);
      result[outcome] += 1;
    } catch { settlementFailed = true; }
  }
  if (settlementFailed) throw new ConnectorOAuthJobError('settlement');
  return result;
}
