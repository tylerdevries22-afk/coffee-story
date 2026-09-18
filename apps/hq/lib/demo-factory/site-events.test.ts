import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { DemoFactoryDb } from './console-data';
import { NO_DEMO_EVENTS, siteEventCounts } from './site-events';

function fakeDb(result: { readonly data?: unknown; readonly error?: unknown } = {}) {
  const calls: { readonly name: string; readonly args: unknown }[] = [];
  const db = {
    rpc: async (name: string, args: unknown) => {
      calls.push({ name, args });
      return { data: result.data ?? null, error: result.error ?? null };
    },
    from: () => {
      throw new Error('siteEventCounts should never touch a table directly');
    },
  };
  return { db: db as unknown as DemoFactoryDb, calls };
}

describe('siteEventCounts', () => {
  it('makes no call and returns nothing for an empty request', async () => {
    const { db, calls } = fakeDb();
    const result = await siteEventCounts(db, []);
    assert.deepEqual([...result], []);
    assert.deepEqual(calls, []);
  });

  it('maps each row, coercing a stringified bigint count', async () => {
    const { db, calls } = fakeDb({
      data: [
        { site_id: 's1', screen_views: '3', last_viewed_at: '2026-09-18T12:00:00Z' },
        { site_id: 's2', screen_views: 1, last_viewed_at: null },
      ],
    });
    const result = await siteEventCounts(db, ['s1', 's2']);
    assert.deepEqual(calls, [{ name: 'platform_demo_event_counts', args: { p_site_ids: ['s1', 's2'] } }]);
    assert.deepEqual(result.get('s1'), { screenViews: 3, lastViewedAt: '2026-09-18T12:00:00Z' });
    assert.deepEqual(result.get('s2'), { screenViews: 1, lastViewedAt: null });
  });

  it('has no entry for a site the rollup did not return', async () => {
    const { db } = fakeDb({ data: [] });
    const result = await siteEventCounts(db, ['s1']);
    assert.equal(result.has('s1'), false);
    assert.deepEqual(result.get('s1') ?? NO_DEMO_EVENTS, NO_DEMO_EVENTS);
  });

  it('skips a malformed row rather than throwing', async () => {
    const { db } = fakeDb({ data: [null, { screen_views: 2 }, 'nope'] });
    const result = await siteEventCounts(db, ['s1']);
    assert.equal(result.size, 0);
  });

  it('surfaces an rpc failure', async () => {
    const { db } = fakeDb({ error: { message: 'down' } });
    await assert.rejects(siteEventCounts(db, ['s1']));
  });
});
