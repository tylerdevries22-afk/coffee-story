import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { SupabaseClient } from '@supabase/supabase-js';

import { fetchActiveLocationOrders, fetchLocationOrderStatuses } from './orders';

function retryingOrdersClient() {
  const signals: AbortSignal[] = [];
  let calls = 0;
  const builder = {
    select: () => builder,
    eq: () => builder,
    or: () => builder,
    order: () => builder,
    abortSignal: (signal: AbortSignal) => {
      signals.push(signal);
      return builder;
    },
    returns: async () => {
      calls += 1;
      return calls === 1
        ? { data: null, error: { message: 'offline' } }
        : { data: [], error: null };
    },
  };
  const client = { from: () => builder } as unknown as SupabaseClient;
  return { client, signals, calls: () => calls };
}

describe('fetchActiveLocationOrders', () => {
  it('bounds every Supabase read and retries a transient failure', async () => {
    const fixture = retryingOrdersClient();
    assert.deepEqual(await fetchActiveLocationOrders(fixture.client, 'location-1'), []);
    assert.equal(fixture.calls(), 2);
    assert.equal(fixture.signals.length, 2);
  });

  it('reads queued terminal statuses instead of treating them as deleted', async () => {
    const signals: AbortSignal[] = [];
    const requestedIds: string[][] = [];
    const builder = {
      select: () => builder,
      eq: () => builder,
      in: (_column: string, ids: string[]) => { requestedIds.push(ids); return builder; },
      abortSignal: (signal: AbortSignal) => { signals.push(signal); return builder; },
      returns: async () => ({
        data: [{ id: 'order-1', status: 'picked_up' as const }], error: null,
      }),
    };
    const client = { from: () => builder } as unknown as SupabaseClient;
    assert.deepEqual(
      await fetchLocationOrderStatuses(client, 'location-1', ['order-1', 'order-1']),
      [{ id: 'order-1', status: 'picked_up' }],
    );
    assert.deepEqual(requestedIds, [['order-1']]);
    assert.equal(signals.length, 1);
  });
});
