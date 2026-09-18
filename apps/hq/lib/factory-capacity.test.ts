import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  FACTORY_BUSY, FACTORY_MAX_RUNNING, factoryRunsBuilding, holdIfFactoryFull, startHeldFactoryRuns, type FactoryDb,
} from './factory-capacity';

type Call = {
  table: string;
  op: 'select' | 'update';
  values?: Record<string, unknown>;
  head?: boolean;
  filters: [string, string, unknown][];
  order?: [string, boolean];
  limit?: number;
};
type Answer = { data?: unknown; count?: number; error?: unknown };

/** A query builder that records each query's shape and answers from `respond`. */
function fakeDb(respond: (call: Call) => Answer) {
  const calls: Call[] = [];
  const builder = (call: Call) => {
    const settle = () => {
      calls.push(call);
      return Promise.resolve({ data: null, count: null, error: null, ...respond(call) });
    };
    const filter = (kind: string) => (column: string, value: unknown) => {
      call.filters.push([kind, column, value]);
      return query;
    };
    const query = {
      select(_columns: string, options?: { head?: boolean }) {
        call.head = options?.head === true;
        return query;
      },
      update(values: Record<string, unknown>) {
        call.op = 'update';
        call.values = values;
        return query;
      },
      eq: filter('eq'), neq: filter('neq'), gt: filter('gt'), in: filter('in'),
      order(column: string, options?: { ascending?: boolean }) {
        call.order = [column, options?.ascending !== false];
        return query;
      },
      limit(count: number) {
        call.limit = count;
        return query;
      },
      maybeSingle: settle,
      then(resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) {
        return settle().then(resolve, reject);
      },
    };
    return query;
  };
  const db = { from: (table: string) => builder({ table, op: 'select', filters: [] }) };
  return { db: db as unknown as FactoryDb, calls };
}

const NOW = new Date('2026-09-18T12:00:00.000Z');
const SIX_HOURS_AGO = '2026-09-18T06:00:00.000Z';

const isCount = (call: Call) => call.op === 'select' && call.head === true;
const has = (call: Call, kind: string, column: string, value: unknown) =>
  call.filters.some(([k, c, v]) => k === kind && c === column && JSON.stringify(v) === JSON.stringify(value));

describe('factoryRunsBuilding', () => {
  it('counts running runs that moved in the last six hours, never the one asking', async () => {
    const { db, calls } = fakeDb(() => ({ count: 2 }));
    assert.equal(await factoryRunsBuilding(db, NOW, 'run-self'), 2);
    const count = calls[0];
    assert.ok(count);
    assert.ok(isCount(count));
    assert.ok(has(count, 'eq', 'state', 'running'));
    assert.ok(has(count, 'gt', 'updated_at', SIX_HOURS_AGO), 'a run untouched for six hours holds no slot');
    assert.ok(has(count, 'neq', 'id', 'run-self'));
  });

  it('fails loudly rather than guessing when it cannot count', async () => {
    const failure = new Error('database unavailable');
    const { db } = fakeDb(() => ({ error: failure }));
    await assert.rejects(factoryRunsBuilding(db, NOW), (error) => error === failure);
  });
});

describe('holdIfFactoryFull', () => {
  it('leaves a run for its caller to start while there is room', async () => {
    const { db, calls } = fakeDb(() => ({ count: FACTORY_MAX_RUNNING - 1 }));
    assert.equal(await holdIfFactoryFull(db, 'run-new', NOW), false);
    assert.ok(calls.every((call) => call.op === 'select'), 'nothing is written');
  });

  it('holds a run at the limit: blocked as factory_busy, with no task left reading as running', async () => {
    const { db, calls } = fakeDb(() => ({ count: FACTORY_MAX_RUNNING }));
    assert.equal(await holdIfFactoryFull(db, 'run-new', NOW), true);
    const run = calls.find((call) => call.op === 'update' && call.table === 'platform_onboarding_runs');
    assert.deepEqual(run?.values, { state: 'blocked', last_error_code: FACTORY_BUSY });
    assert.ok(run && has(run, 'eq', 'id', 'run-new'));
    assert.ok(run && has(run, 'in', 'state', ['draft', 'running', 'blocked', 'failed']), 'a live run is never held');
    const tasks = calls.find((call) => call.op === 'update' && call.table === 'platform_onboarding_tasks');
    assert.deepEqual(tasks?.values, { state: 'pending' });
    assert.ok(tasks && has(tasks, 'eq', 'run_id', 'run-new') && has(tasks, 'eq', 'state', 'running'));
  });

  it('surfaces a hold that could not be written', async () => {
    const failure = new Error('write failed');
    const { db } = fakeDb((call) => (isCount(call) ? { count: FACTORY_MAX_RUNNING } : call.table === 'platform_onboarding_runs' ? { error: failure } : {}));
    await assert.rejects(holdIfFactoryFull(db, 'run-new', NOW), (error) => error === failure);
  });
});

describe('startHeldFactoryRuns', () => {
  const heldRuns = (ids: string[], building: number, lost: string[] = []) => fakeDb((call) => {
    if (isCount(call)) return { count: building };
    if (call.op === 'select') return { data: ids.slice(0, call.limit).map((id) => ({ id })) };
    const id = call.filters.find(([kind, column]) => kind === 'eq' && column === 'id')?.[2];
    if (call.values?.state === 'running') return { data: lost.includes(String(id)) ? null : { id } };
    return {};
  });

  it('starts the longest-waiting held runs, as many as there is room for', async () => {
    const { db, calls } = heldRuns(['oldest', 'middle', 'newest'], 1);
    const launched: string[] = [];
    assert.equal(await startHeldFactoryRuns(db, async (id) => launched.push(id), NOW), 2);
    assert.deepEqual(launched, ['oldest', 'middle']);
    const list = calls.find((call) => call.op === 'select' && !call.head);
    assert.deepEqual(list?.order, ['updated_at', true]);
    assert.equal(list?.limit, FACTORY_MAX_RUNNING - 1);
    assert.ok(list && has(list, 'eq', 'state', 'blocked') && has(list, 'eq', 'last_error_code', FACTORY_BUSY));
  });

  it('claims each run before starting it, and skips one another tick claimed first', async () => {
    const { db, calls } = heldRuns(['taken', 'free'], 0, ['taken']);
    const launched: string[] = [];
    assert.equal(await startHeldFactoryRuns(db, async (id) => launched.push(id), NOW), 1);
    assert.deepEqual(launched, ['free']);
    const claims = calls.filter((call) => call.values?.state === 'running');
    assert.equal(claims.length, 2);
    for (const claim of claims) {
      assert.deepEqual(claim.values, { state: 'running', last_error_code: null });
      assert.ok(has(claim, 'eq', 'state', 'blocked') && has(claim, 'eq', 'last_error_code', FACTORY_BUSY));
    }
  });

  it('marks a run whose workflow would not start as failed, and carries on', async () => {
    const { db, calls } = heldRuns(['broken', 'fine'], 0);
    const launched: string[] = [];
    const started = await startHeldFactoryRuns(db, async (id) => {
      if (id === 'broken') throw new Error('workflow unavailable');
      launched.push(id);
    }, NOW);
    assert.equal(started, 1);
    assert.deepEqual(launched, ['fine']);
    const failed = calls.find((call) => call.values?.state === 'failed');
    assert.deepEqual(failed?.values, { state: 'failed', last_error_code: 'workflow_start_failed' });
    assert.ok(failed && has(failed, 'eq', 'id', 'broken'));
  });

  it('starts nothing, and reads no queue, when the factory is full', async () => {
    const { db, calls } = heldRuns(['waiting'], FACTORY_MAX_RUNNING);
    let launches = 0;
    assert.equal(await startHeldFactoryRuns(db, async () => { launches += 1; }, NOW), 0);
    assert.equal(launches, 0);
    assert.equal(calls.length, 1, 'only the count');
  });
});
