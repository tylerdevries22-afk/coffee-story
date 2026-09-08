import assert from 'node:assert/strict';
import { it } from 'node:test';

import { POST } from '../app/api/jobs/run/route';

const ENV = {
  CRON_SECRET: 'test-cron-secret',
  SUPABASE_URL: 'https://database.example.test',
  SUPABASE_SERVICE_ROLE_KEY: 'test-service-key',
};
const MUTATED_ENV_KEYS = [
  ...Object.keys(ENV), 'OPENAI_API_KEY', 'OPENAI_RESEARCH_MODEL', 'SQUARE_APP_ID',
];

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
