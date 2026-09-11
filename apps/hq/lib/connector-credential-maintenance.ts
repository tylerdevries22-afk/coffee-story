import type { SupabaseClient } from '@supabase/supabase-js';

import { connectorRpc } from './connector-rpc';

const RECONCILIATION_LIMIT = 100;

export class ConnectorCredentialMaintenanceError extends Error {
  constructor() {
    super('Connector credential reconciliation failed.');
    this.name = 'ConnectorCredentialMaintenanceError';
  }
}

/** Reconcile visible connector status with credential expiry and revocation. */
export async function reconcileConnectorCredentials(
  db: SupabaseClient,
  now: Date,
): Promise<number> {
  const args = {
    p_now: now.toISOString(),
    p_limit: RECONCILIATION_LIMIT,
  };
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const result = await connectorRpc(db, 'reconcile_connector_credential_status', args);
      if (!result.error && Number.isInteger(result.data) && Number(result.data) >= 0) {
        return Number(result.data);
      }
    } catch { /* this reconciliation is idempotent */ }
  }
  throw new ConnectorCredentialMaintenanceError();
}
