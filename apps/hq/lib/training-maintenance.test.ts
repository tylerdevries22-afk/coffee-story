import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { SupabaseClient } from '@supabase/supabase-js';
import { runTrainingMaintenance } from './training-maintenance';

function database(failure: Error | null) {
  const writes: Record<string, unknown>[] = [];
  const filters: unknown[][] = [];
  const query = {
    select() { return query; }, order() { return query; }, range() { return query; },
    eq(key: string, value: unknown) { filters.push([key, value]); return query; },
    returns() { return Promise.resolve({ data: [], error: null }); },
    insert(values: Record<string, unknown>) { writes.push(values); return Promise.resolve({ error: null }); },
    update(values: Record<string, unknown>) { writes.push(values); return query; },
    then(resolve: (value: { error: Error | null }) => unknown) { return Promise.resolve(resolve({ error: failure })); },
  };
  const brands = { ...query, select() { return brands; }, order() { return brands; },
    range() { return brands; }, returns() {
      return Promise.resolve({ data: [{ id: 'brand', name: 'Test cafe', brand_config: {} }], error: null });
    } };
  const db = { from(table: string) { return table === 'brands' ? brands : query; } } as unknown as SupabaseClient;
  return { db, writes, filters };
}

for (const persistenceFails of [false, true]) {
  test(`dispatch rejection ${persistenceFails ? 'surfaces a failure to record recovery' : 'records a retryable failed run'}`, async () => {
    const original = { key: process.env.OPENAI_API_KEY, model: process.env.OPENAI_RESEARCH_MODEL };
    process.env.OPENAI_API_KEY = 'test-only';
    process.env.OPENAI_RESEARCH_MODEL = 'test-model';
    try {
      const failure = persistenceFails ? new Error('database unavailable') : null;
      const { db, writes, filters } = database(failure);
      let dispatches = 0;
      const result = runTrainingMaintenance(db, async (input) => {
        dispatches += 1;
        assert.equal(input.brandId, 'brand');
        assert.ok(input.runId);
        throw new Error('provider detail must not be stored');
      });
      if (persistenceFails) {
        await assert.rejects(result, (error: Error) => {
          assert.equal(error.message, 'Training dispatch failure could not be recorded.');
          assert.equal(error.cause, failure);
          return true;
        });
      } else assert.equal(await result, 0);
      assert.equal(dispatches, 1);
      assert.equal(writes[0]?.status, 'queued');
      assert.equal(writes[1]?.status, 'failed');
      assert.equal(writes[1]?.error_code, 'workflow_start_failed');
      assert.deepEqual(filters.slice(-2), [['id', writes[0]?.id], ['brand_id', 'brand']]);
      assert.ok(!JSON.stringify(writes).includes('provider detail'));
    } finally {
      if (original.key === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = original.key;
      if (original.model === undefined) delete process.env.OPENAI_RESEARCH_MODEL;
      else process.env.OPENAI_RESEARCH_MODEL = original.model;
    }
  });
}
