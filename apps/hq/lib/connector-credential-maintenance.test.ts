import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { SupabaseClient } from '@supabase/supabase-js';

import {
  ConnectorCredentialMaintenanceError,
  reconcileConnectorCredentials,
} from './connector-credential-maintenance';

describe('reconcileConnectorCredentials', () => {
  it('uses a bounded service-only reconciliation request', async () => {
    const calls: unknown[] = [];
    const db = { rpc: async (name: string, args: unknown) => {
      calls.push({ name, args });
      return { data: 3, error: null };
    } } as unknown as SupabaseClient;
    const now = new Date('2026-09-08T12:00:00.000Z');

    assert.equal(await reconcileConnectorCredentials(db, now), 3);
    assert.deepEqual(calls, [{
      name: 'reconcile_connector_credential_status',
      args: { p_now: now.toISOString(), p_limit: 100 },
    }]);
  });

  it('rejects database errors and malformed counts', async () => {
    for (const result of [
      { data: null, error: { message: 'unavailable' } },
      { data: -1, error: null },
      { data: 1.5, error: null },
    ]) {
      const db = { rpc: async () => result } as unknown as SupabaseClient;
      await assert.rejects(reconcileConnectorCredentials(db, new Date()), (error: unknown) => {
        assert.ok(error instanceof ConnectorCredentialMaintenanceError);
        assert.ok(!error.message.includes('unavailable'));
        return true;
      });
    }
  });
});
