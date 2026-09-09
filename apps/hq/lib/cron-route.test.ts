import assert from 'node:assert/strict';
import { it } from 'node:test';

import { GET, POST } from '../app/api/jobs/run/route';

const ENV = {
  CRON_SECRET: 'test-cron-secret',
  SUPABASE_URL: 'https://database.example.test',
  SUPABASE_SERVICE_ROLE_KEY: 'test-service-key',
};
const MUTATED_ENV_KEYS = [
  ...Object.keys(ENV), 'OPENAI_API_KEY', 'OPENAI_RESEARCH_MODEL', 'SQUARE_APP_ID',
];

it('uses the authenticated maintenance handler for scheduled GET requests', async (t) => {
  const original = process.env.CRON_SECRET;
  process.env.CRON_SECRET = ENV.CRON_SECRET;
  t.after(() => {
    if (original === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = original;
  });

  const response = await GET(new Request('https://hq.example.test/api/jobs/run'));
  assert.equal(response.status, 401);
});

it('runs healthy maintenance stages when the drops stage fails', async (t) => {
  const originalEnv = Object.fromEntries(MUTATED_ENV_KEYS.map((key) => [key, process.env[key]]));
  Object.assign(process.env, ENV);
  delete process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_RESEARCH_MODEL;
  delete process.env.SQUARE_APP_ID;
  t.after(() => {
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });
  t.mock.method(console, 'warn', () => undefined);
  const paths: string[] = [];
  t.mock.method(globalThis, 'fetch', async (input: string | URL | Request) => {
    const path = new URL(String(input)).pathname;
    paths.push(path);
    if (path === '/rest/v1/rpc/reconcile_connector_credential_status') return Response.json(0);
    return path === '/rest/v1/rpc/advance_due_drop_batch'
      ? Response.json({ message: 'drops unavailable' }, { status: 400 })
      : Response.json([]);
  });

  const request = new Request('https://hq.example.test/api/jobs/run', {
    method: 'POST', headers: { authorization: `Bearer ${ENV.CRON_SECRET}` },
  });
  await assert.rejects(POST(request), (error) => {
    assert.ok(error instanceof AggregateError);
    assert.match(error.errors[0]?.message ?? '', /drops/);
    return true;
  });
  assert.deepEqual(new Set(paths), new Set([
    '/rest/v1/rpc/advance_due_drop_batch',
    '/rest/v1/campaigns',
    '/rest/v1/rpc/refresh_analytics_rollups',
    '/rest/v1/rpc/prune_analytics_retention',
    '/rest/v1/rpc/run_operation_maintenance',
    '/rest/v1/rpc/queue_due_operation_escalations',
    '/rest/v1/rpc/claim_operation_notification_batch',
    '/rest/v1/rpc/apply_operation_retention',
    '/rest/v1/rpc/prune_delegated_access_grants',
    '/rest/v1/rpc/reconcile_connector_credential_status',
  ]));
});

it('advances due drops through the atomic hosted batch', async (t) => {
  const originalEnv = Object.fromEntries(MUTATED_ENV_KEYS.map((key) => [key, process.env[key]]));
  Object.assign(process.env, ENV);
  delete process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_RESEARCH_MODEL;
  delete process.env.SQUARE_APP_ID;
  t.after(() => {
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });
  t.mock.method(console, 'warn', () => undefined);
  const requests: { method: string; url: string; body: string | null }[] = [];
  t.mock.method(globalThis, 'fetch', async (
    input: string | URL | Request,
    init?: RequestInit,
  ) => {
    const request = new Request(input, init);
    requests.push({ method: request.method, url: request.url, body: await request.text() || null });
    const path = new URL(request.url).pathname;
    if (path === '/rest/v1/rpc/reconcile_connector_credential_status') return Response.json(0);
    if (path === '/rest/v1/rpc/advance_due_drop_batch') {
      return Response.json([{ id: 'drop-scheduled' }, { id: 'drop-revealed' }]);
    }
    return Response.json([]);
  });

  const response = await POST(new Request('https://hq.example.test/api/jobs/run', {
    method: 'POST', headers: { authorization: `Bearer ${ENV.CRON_SECRET}` },
  }));

  assert.equal(response.status, 200);
  assert.equal((await response.json()).drops, 2);
  const calls = requests.filter((request) =>
    new URL(request.url).pathname === '/rest/v1/rpc/advance_due_drop_batch');
  assert.equal(calls.length, 1);
  const input = JSON.parse(calls[0]?.body ?? '{}') as Record<string, unknown>;
  assert.equal(input.target_limit, 200);
  assert.equal(typeof input.target_now, 'string');
});

it('caps each cron tick at five full drop batches', async (t) => {
  const originalEnv = Object.fromEntries(MUTATED_ENV_KEYS.map((key) => [key, process.env[key]]));
  Object.assign(process.env, ENV);
  delete process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_RESEARCH_MODEL;
  delete process.env.SQUARE_APP_ID;
  t.after(() => {
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });
  t.mock.method(console, 'warn', () => undefined);
  let dropCalls = 0;
  t.mock.method(globalThis, 'fetch', async (input: string | URL | Request) => {
    const path = new URL(String(input)).pathname;
    if (path === '/rest/v1/rpc/reconcile_connector_credential_status') return Response.json(0);
    if (path === '/rest/v1/rpc/advance_due_drop_batch') {
      dropCalls += 1;
      return Response.json(Array.from({ length: 200 }, (_, index) => ({ id: `drop-${index}` })));
    }
    return Response.json([]);
  });

  const response = await POST(new Request('https://hq.example.test/api/jobs/run', {
    method: 'POST', headers: { authorization: `Bearer ${ENV.CRON_SECRET}` },
  }));

  assert.equal(response.status, 200);
  assert.equal((await response.json()).drops, 1_000);
  assert.equal(dropCalls, 5);
});
