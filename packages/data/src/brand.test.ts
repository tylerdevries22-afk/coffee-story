import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { SupabaseClient } from '@supabase/supabase-js';

import { fetchBrandConfig, subscribeToBrandConfig } from './brand';

function clientFor(config: unknown) {
  const removed: unknown[] = [];
  const channel = {
    on() { return channel; },
    subscribe(callback?: (status: string) => void) { callback?.('SUBSCRIBED'); return channel; },
  };
  const builder = {
    select() { return builder; },
    eq() { return builder; },
    abortSignal() { return builder; },
    maybeSingle: async () => ({ data: { brand_config: config }, error: null }),
  };
  const client = {
    from() { return builder; },
    channel() { return channel; },
    removeChannel(value: unknown) { removed.push(value); return Promise.resolve('ok'); },
  } as unknown as SupabaseClient;
  return { client, removed, channel };
}

describe('brand kiosk configuration data', () => {
  it('reads through the public storefront view', async () => {
    const { client } = clientFor({ kiosk: { entry: { prompt: 'Pick a cup' } } });
    assert.deepEqual(await fetchBrandConfig(client, 'brand-1'), { kiosk: { entry: { prompt: 'Pick a cup' } } });
  });

  it('coalesces signal reconnects and removes the channel on cleanup', async () => {
    const { client, removed } = clientFor(null);
    let changes = 0;
    const stop = subscribeToBrandConfig(client, 'brand-1', () => { changes += 1; }, 5);
    await new Promise((resolve) => setTimeout(resolve, 15));
    assert.equal(changes, 1);
    stop();
    assert.equal(removed.length, 1);
  });
});
