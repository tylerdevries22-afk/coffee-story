import type { SupabaseClient } from '@supabase/supabase-js';

import { reconcileConnectorCredentials } from './connector-credential-maintenance';
import { ConnectorOAuthJobError } from './connector-oauth-job-contract';
import { runConnectorOAuthIdentities } from './connector-oauth-identity-maintenance';
import {
  runConnectorOAuthRefreshes,
  runConnectorOAuthRevocations,
  type ConnectorOAuthMaintenanceResult,
} from './connector-oauth-maintenance';

/** Keep rotation ahead of expiry reconciliation and avoid lifecycle races. */
export async function runConnectorOAuthLifecycle(db: SupabaseClient, now: Date) {
  const errors: Error[] = [];
  let identities: Awaited<ReturnType<typeof runConnectorOAuthIdentities>> | null = null;
  let revocations: ConnectorOAuthMaintenanceResult | null = null;
  let refreshes: ConnectorOAuthMaintenanceResult | null = null;
  let reconciled: number | null = null;
  try { identities = await runConnectorOAuthIdentities(db, now); } catch (error) {
    errors.push(error instanceof Error ? error : new ConnectorOAuthJobError('settlement'));
  }
  try { revocations = await runConnectorOAuthRevocations(db, now); } catch (error) {
    errors.push(error instanceof Error ? error : new ConnectorOAuthJobError('settlement'));
  }
  try { refreshes = await runConnectorOAuthRefreshes(db, now); } catch (error) {
    errors.push(error instanceof Error ? error : new ConnectorOAuthJobError('settlement'));
  }
  try { reconciled = await reconcileConnectorCredentials(db, now); } catch (error) {
    errors.push(error instanceof Error ? error : new ConnectorOAuthJobError('settlement'));
  }
  if (errors.length) throw new AggregateError(errors, 'Connector OAuth lifecycle failed.');
  return { identities, revocations, refreshes, reconciled };
}
