import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { SupabaseClient } from '@supabase/supabase-js';

import { loadSquareMaintenanceAlerts } from './square-maintenance-alerts';

describe('Square maintenance alerts', () => {
  it('loads bounded database counts, including bigint text', async () => {
    const db = { rpc: async (name: string) => ({
      data: name.includes('remediation') ? '2' : name.includes('validation') ? 4 : 3, error: null,
    }) } as unknown as SupabaseClient;
    assert.deepEqual(await loadSquareMaintenanceAlerts(db), {
      paymentRemediations: 2, paymentValidations: 4, connectionMutations: 3, scanFailed: false,
    });
  });

  it('fails closed on an error or malformed count', async () => {
    const db = { rpc: async (name: string) => name.includes('payment')
      ? { data: -1, error: null }
      : { data: null, error: { message: 'private detail' } } } as unknown as SupabaseClient;
    assert.deepEqual(await loadSquareMaintenanceAlerts(db), {
      paymentRemediations: 0, paymentValidations: 0, connectionMutations: 0, scanFailed: true,
    });
  });
});
