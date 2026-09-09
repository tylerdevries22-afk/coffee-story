import assert from 'node:assert/strict';
import { it } from 'node:test';

import type { SupabaseClient } from '@supabase/supabase-js';

import { runConnectorOAuthLifecycle } from './connector-oauth-lifecycle-runner';

it('runs revocation and refresh leases before expiry reconciliation', async () => {
  const calls: string[] = [];
  const db = {
    rpc: async (name: string) => {
      calls.push(name);
      if (name.startsWith('claim_connector_oauth_')) return { data: [], error: null };
      if (name === 'reconcile_connector_credential_status') return { data: 0, error: null };
      return { data: null, error: { code: 'unexpected' } };
    },
  } as unknown as SupabaseClient;

  assert.deepEqual(await runConnectorOAuthLifecycle(db, new Date('2026-09-08T12:00:00Z')), {
    identities: { claimed: 0, completed: 0, failed: 0, stale: 0 },
    revocations: { claimed: 0, completed: 0, failed: 0, stale: 0 },
    refreshes: { claimed: 0, completed: 0, failed: 0, stale: 0 },
    reconciled: 0,
  });
  assert.deepEqual(calls, [
    'claim_connector_oauth_identities',
    'claim_connector_oauth_revocations',
    'claim_connector_oauth_refreshes',
    'reconcile_connector_credential_status',
  ]);
});
