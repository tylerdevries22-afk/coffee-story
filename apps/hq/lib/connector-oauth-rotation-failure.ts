import type { SupabaseClient } from '@supabase/supabase-js';

import type { ConnectorOAuthClaim } from './connector-oauth-job-contract';
import { settleConnectorOAuthJob } from './connector-oauth-job-contract';
import { ConnectorRefreshError, connectorTokenExpiry } from './connector-oauth-refresh';

export async function settleIssuedConnectorRotationFailure(
  db: SupabaseClient,
  job: Pick<ConnectorOAuthClaim, 'jobId' | 'leaseToken'>,
  now: Date,
  error: unknown,
): Promise<'failed' | 'stale' | null> {
  if (!(error instanceof ConnectorRefreshError) || !error.issuedCredential) return null;
  const accepted = await settleConnectorOAuthJob(
    db, 'quarantine_connector_oauth_rotation_result', {
      p_job_id: job.jobId, p_lease_token: job.leaseToken,
      p_credential: error.issuedCredential,
      p_expires_at: connectorTokenExpiry(error.issuedCredential, now),
      p_reason: error.code, p_now: now.toISOString(),
    },
  );
  return accepted ? 'failed' : 'stale';
}
