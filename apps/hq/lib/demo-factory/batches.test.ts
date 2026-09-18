import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { PlacesError } from '@platform/engine';

import { createDemoBatch, stopDemoBatch, updateDemoSettings } from './batches';
import { fakeFactoryDb } from './demo-factory.test-support';
import { demoCostRow, recordDemoCost } from './ledger';
import { estimateDemoMicrousd } from './prices';

const USER = '8a1f0c3e-5b7d-4e2a-9c41-0d6b3e8f2a17';
const BATCH = 'b0000000-1000-4000-8000-000000000001';

/** Runs `body` with console.error silenced, for paths that log on purpose. */
async function quietly<T>(body: () => Promise<T>): Promise<T> {
  const original = console.error;
  console.error = () => {};
  try {
    return await body();
  } finally {
    console.error = original;
  }
}

describe('createDemoBatch', () => {
  it('searches, lets the database decide what to build, and books the free search', async () => {
    const { db, calls } = fakeFactoryDb({ rpc: { create_platform_demo_batch: { data: [{ id: BATCH, found: 3, queued: 2 }] } } });
    const searched: unknown[] = [];
    const result = await createDemoBatch(db, async (query, limit) => {
      searched.push([query, limit]);
      return ['ChIJOne', 'ChIJTwo', 'ChIJThree', 'ChIJFour'];
    }, { query: 'coffee shops in Boulder, CO', count: 3 }, USER);

    assert.deepEqual(result, { kind: 'created', batchId: BATCH, found: 3, queued: 2 });
    assert.deepEqual(searched, [['coffee shops in Boulder, CO', 3]]);
    assert.deepEqual(calls[0], { kind: 'rpc', args: ['create_platform_demo_batch', {
      p_query: 'coffee shops in Boulder, CO',
      p_requested: 3,
      p_place_ids: ['ChIJOne', 'ChIJTwo', 'ChIJThree'],
      p_unit_estimate_microusd: estimateDemoMicrousd(),
      p_created_by: USER,
    }] });
    assert.deepEqual(calls[1], { kind: 'insert', args: ['platform_demo_costs', {
      batch_id: BATCH, job_id: null, provider: 'google_places', sku: 'text_search_ids', model: null, quantity: 1, cost_microusd: 0,
    }] });
  });

  it('queues nothing when the search cannot run, and says why', async () => {
    const cases = [
      [new PlacesError('unconfigured'), 'places_unconfigured'],
      [new PlacesError('over_quota'), 'places_quota'],
      [new PlacesError('provider'), 'places_error'],
      [new Error('socket hang up'), 'places_error'],
    ] as const;
    for (const [error, code] of cases) {
      const { db, calls } = fakeFactoryDb();
      const result = await createDemoBatch(db, async () => { throw error; }, { query: 'bakeries', count: 5 }, USER);
      assert.deepEqual(result, { kind: 'failed', code });
      assert.deepEqual(calls, [], 'nothing reached the database');
    }
  });

  it('reports a database refusal as such', async () => {
    const { db } = fakeFactoryDb({ rpc: { create_platform_demo_batch: { error: { message: 'down' } } } });
    const result = await quietly(() => createDemoBatch(db, async () => ['ChIJOne'], { query: 'bakeries', count: 1 }, USER));
    assert.deepEqual(result, { kind: 'failed', code: 'database' });
  });

  it('keeps a created batch when only the free search line fails to book', async () => {
    const { db } = fakeFactoryDb({
      rpc: { create_platform_demo_batch: { data: { id: BATCH, found: 1, queued: 1 } } },
      insertError: { message: 'ledger down' },
    });
    const result = await quietly(() => createDemoBatch(db, async () => ['ChIJOne'], { query: 'bakeries', count: 1 }, null));
    assert.equal(result.kind, 'created');
  });
});

describe('the ledger', () => {
  it('prices a line when it is booked, and throws rather than lose a paid call', async () => {
    const { db, calls } = fakeFactoryDb();
    const cost = await recordDemoCost(db, { batchId: BATCH, jobId: 'j1' },
      { provider: 'openai', sku: 'output_tokens', model: 'GPT-5-Mini-2025-08-07', quantity: 1_000 });
    assert.equal(cost, 2_000);
    assert.equal((calls[0]?.args[1] as { model: string }).model, 'gpt-5-mini-2025-08-07');
    const failing = fakeFactoryDb({ insertError: { message: 'down' } });
    await assert.rejects(recordDemoCost(failing.db, { batchId: BATCH, jobId: null },
      { provider: 'google_places', sku: 'place_photo', quantity: 1 }));
  });

  it('books an unreadable model name as unknown, at the dearest price', () => {
    const row = demoCostRow({ batchId: BATCH, jobId: null },
      { provider: 'openai', sku: 'output_tokens', model: 'model with spaces!', quantity: 1_000 });
    assert.equal(row.model, 'unknown');
    assert.equal(row.cost_microusd, 10_000);
  });
});

describe('the brakes', () => {
  it('stops a batch and reports how many businesses never started', async () => {
    const { db, calls } = fakeFactoryDb({ rpc: { stop_platform_demo_batch: { data: 4 } } });
    assert.equal(await stopDemoBatch(db, BATCH), 4);
    assert.deepEqual(calls, [{ kind: 'rpc', args: ['stop_platform_demo_batch', { p_batch_id: BATCH }] }]);
  });

  it('switches without touching the limits, and sets limits without touching the switch', async () => {
    const { db, calls } = fakeFactoryDb();
    await updateDemoSettings(db, { enabled: false }, USER);
    await updateDemoSettings(db, { dailyLimit: 50, dailyBudgetMicrousd: 5_000_000 }, USER);
    assert.deepEqual(calls, [
      { kind: 'update', args: ['platform_demo_settings', { enabled: false, updated_by: USER }, 'singleton', true] },
      { kind: 'update', args: ['platform_demo_settings',
        { daily_limit: 50, daily_budget_microusd: 5_000_000, updated_by: USER }, 'singleton', true] },
    ]);
  });

  it('surfaces a failed change', async () => {
    const { db } = fakeFactoryDb({ updateError: { message: 'down' }, rpc: { stop_platform_demo_batch: { error: { message: 'x' } } } });
    await assert.rejects(updateDemoSettings(db, { enabled: true }, USER));
    await assert.rejects(stopDemoBatch(db, BATCH));
  });
});
