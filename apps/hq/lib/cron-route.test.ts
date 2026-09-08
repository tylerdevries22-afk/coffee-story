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
    return path === '/rest/v1/drops'
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
    '/rest/v1/drops',
    '/rest/v1/campaigns',
    '/rest/v1/rpc/refresh_analytics_rollups',
    '/rest/v1/rpc/prune_analytics_retention',
    '/rest/v1/rpc/run_operation_maintenance',
    '/rest/v1/rpc/queue_due_operation_escalations',
    '/rest/v1/rpc/claim_operation_notification_batch',
    '/rest/v1/rpc/apply_operation_retention',
    '/rest/v1/rpc/prune_delegated_access_grants',
  ]));
});

it('advances scheduled and revealed drops through the hosted cron route', async (t) => {
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
    if (path === '/rest/v1/drops' && request.method === 'GET') {
      return Response.json([
        {
          id: 'drop-scheduled', status: 'scheduled', reveal_at: '2026-01-01T00:00:00.000Z',
          starts_at: '2098-01-01T00:00:00.000Z', ends_at: '2099-01-01T00:00:00.000Z',
        },
        {
          id: 'drop-revealed', status: 'revealed', reveal_at: '2026-01-01T00:00:00.000Z',
          starts_at: '2026-02-01T00:00:00.000Z', ends_at: '2099-01-01T00:00:00.000Z',
        },
      ]);
    }
    return Response.json([]);
  });

  const response = await POST(new Request('https://hq.example.test/api/jobs/run', {
    method: 'POST', headers: { authorization: `Bearer ${ENV.CRON_SECRET}` },
  }));

  assert.equal(response.status, 200);
  assert.equal((await response.json()).drops, 2);
  const read = requests.find((request) => request.method === 'GET'
    && new URL(request.url).pathname === '/rest/v1/drops');
  assert.match(decodeURIComponent(read?.url ?? ''), /select=id,status,reveal_at,starts_at,ends_at/);
  assert.match(decodeURIComponent(read?.url ?? ''), /status=in\.\(scheduled,revealed,live\)/);
  const writes = requests.filter((request) => request.method === 'PATCH'
    && new URL(request.url).pathname === '/rest/v1/drops');
  assert.deepEqual(writes.map((write) => JSON.parse(write.body ?? '{}')),
    [{ status: 'revealed' }, { status: 'live' }]);
});
