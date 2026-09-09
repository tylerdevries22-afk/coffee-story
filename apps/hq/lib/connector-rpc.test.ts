import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { SupabaseClient } from '@supabase/supabase-js';

import {
  connectorRpc,
  ConnectorRpcTransportError,
} from './connector-rpc';

describe('connectorRpc', () => {
  it('returns only the PostgREST data and error contract', async () => {
    const db = ({
      rpc: async () => ({ data: true, error: null, ignored: 'value' }),
    } as unknown) as SupabaseClient;
    assert.deepEqual(await connectorRpc(db, 'safe_rpc', {}), { data: true, error: null });
  });

  it('aborts a stalled builder and exposes a fixed safe error', async () => {
    let aborted = false;
    const db = { rpc: () => ({ abortSignal: (signal: AbortSignal) =>
      new Promise((_resolve, reject) => signal.addEventListener('abort', () => {
        aborted = true;
        reject(new Error('private database detail'));
      }, { once: true })) }) } as unknown as SupabaseClient;
    await assert.rejects(connectorRpc(db, 'safe_rpc', {}, 2), (error: unknown) => {
      assert.ok(error instanceof ConnectorRpcTransportError);
      assert.ok(!error.message.includes('private database detail'));
      return true;
    });
    assert.equal(aborted, true);
  });

  it('normalizes a synchronous client failure', async () => {
    const db = ({
      rpc: () => { throw new Error('private database detail'); },
    } as unknown) as SupabaseClient;
    await assert.rejects(connectorRpc(db, 'safe_rpc', {}), ConnectorRpcTransportError);
  });
});
