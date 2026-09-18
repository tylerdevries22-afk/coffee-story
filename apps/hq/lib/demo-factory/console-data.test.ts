import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { batchFrom, dailyFrom, demoFactoryReadiness, loadDemoConsole, settingsFrom } from './console-data';
import { fakeFactoryDb } from './demo-factory.test-support';

describe('settingsFrom', () => {
  it('reads the switch and the brakes, bigints included', () => {
    assert.deepEqual(settingsFrom({ enabled: true, daily_limit: 100, daily_budget_microusd: '10000000' }),
      { enabled: true, dailyLimit: 100, dailyBudgetMicrousd: 10_000_000 });
  });

  it('treats a missing or odd row as off, never as on', () => {
    for (const row of [null, undefined, 'on', { enabled: 'true' }, { enabled: 1 }]) {
      assert.equal(settingsFrom(row).enabled, false, JSON.stringify(row));
    }
  });
});

describe('batchFrom and dailyFrom', () => {
  it('map every column, and a drifted one to zero rather than NaN', () => {
    const batch = batchFrom({
      id: 'b1', query: 'bakeries', state: 'done', requested: 5, found: '4', queued: 0, working: 0,
      built: 3, skipped: 1, failed: 0, unit_estimate_microusd: 30475, cost_microusd: '61000',
      created_at: '2026-09-18T09:30:00+00:00',
    });
    assert.equal(batch.found, 4);
    assert.equal(batch.costMicrousd, 61_000);
    assert.equal(batch.state, 'done');
    assert.equal(batchFrom({ id: 'b2', built: 'lots', state: 'mystery' }).built, 0);
    assert.equal(batchFrom({ id: 'b2', state: 'mystery' }).state, 'running');
    assert.deepEqual(dailyFrom({ day: '2026-09-18', provider: 'openai', sku: 'output_tokens', model: 'gpt-5-nano',
      quantity: 3000, cost_microusd: 1200 }),
    { day: '2026-09-18', provider: 'openai', sku: 'output_tokens', model: 'gpt-5-nano', quantity: 3000, costMicrousd: 1200 });
  });
});

describe('demoFactoryReadiness', () => {
  it('says whether each piece is configured, and never what it is', () => {
    assert.deepEqual(demoFactoryReadiness({}), { placesKey: false, openAiKey: false, builderName: false });
    const ready = demoFactoryReadiness({
      GOOGLE_PLACES_API_KEY: 'test-places', OPENAI_API_KEY: '  ', DEMO_BUILDER_NAME: 'Example Studio',
    });
    assert.deepEqual(ready, { placesKey: true, openAiKey: false, builderName: true });
    assert.equal(JSON.stringify(ready).includes('test-places'), false);
  });
});

describe('loadDemoConsole', () => {
  it('reads the brakes, the batch list and fourteen days of spend', async () => {
    const { db, calls } = fakeFactoryDb({
      settingsRow: { enabled: false, daily_limit: 100, daily_budget_microusd: 10_000_000 },
      rpc: {
        platform_demo_batch_summaries: { data: [{ id: 'b1', query: 'bakeries', state: 'running' }, { query: 'no id' }] },
        platform_demo_daily_costs: { data: [{ day: '2026-09-18', provider: 'google_places', sku: 'place_details_enterprise',
          model: null, quantity: 2, cost_microusd: 40000 }] },
      },
    });
    const loaded = await loadDemoConsole(db);
    assert.equal(loaded.settings.dailyLimit, 100);
    assert.deepEqual(loaded.batches.map((batch) => batch.id), ['b1'], 'a row without an id is dropped');
    assert.equal(loaded.daily[0]?.costMicrousd, 40_000);
    assert.deepEqual(calls.map((call) => call.args[0]),
      ['platform_demo_settings', 'platform_demo_batch_summaries', 'platform_demo_daily_costs']);
  });

  it('throws on a failed read instead of showing an empty factory', async () => {
    const { db } = fakeFactoryDb({ selectError: { message: 'down' } });
    await assert.rejects(loadDemoConsole(db));
  });
});
