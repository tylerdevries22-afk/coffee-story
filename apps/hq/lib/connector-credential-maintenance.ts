import type { SupabaseClient } from '@supabase/supabase-js';

const RECONCILIATION_LIMIT = 100;

/** Reconcile visible connector status with credential expiry and revocation. */
export async function reconcileConnectorCredentials(
  db: SupabaseClient,
  now: Date,
): Promise<number> {
  const result = await db.rpc('reconcile_connector_credential_status', {
    p_now: now.toISOString(),
    p_limit: RECONCILIATION_LIMIT,
  });
  if (result.error) throw result.error;
  if (!Number.isInteger(result.data) || result.data < 0) {
    throw new Error('Connector credential reconciliation returned an invalid count.');
  }
  return result.data;
}
