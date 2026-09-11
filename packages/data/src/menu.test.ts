import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { SupabaseClient } from '@supabase/supabase-js';

import { fetchMenuTree, PUBLIC_DROP_STATUSES } from './menu';

function clientRecordingDropStatuses(seen: unknown[][]): SupabaseClient {
  const resolving = (table: string) => {
    const builder = {
      select() { return builder; },
      eq() { return builder; },
      order() { return builder; },
      abortSignal() { return builder; },
      returns() { return builder; },
      in(column: string, values: unknown[]) {
        if (table === 'drops' && column === 'status') seen.push(values);
        return builder;
      },
      then(resolve: (value: { data: unknown[]; error: null }) => void) {
        resolve({ data: table === 'menus' ? [{ id: 'menu-1' }] : [], error: null });
      },
    };
    return builder;
  };
  return {
    from(table: string) { return resolving(table); },
    rpc() { return resolving('rpc'); },
  } as unknown as SupabaseClient;
}

describe('public menu drops', () => {
  it('requests every guest-visible lifecycle state', async () => {
    const seen: unknown[][] = [];
    await fetchMenuTree(clientRecordingDropStatuses(seen), 'brand-1');
    assert.deepEqual(seen, [[...PUBLIC_DROP_STATUSES]]);
  });
});
