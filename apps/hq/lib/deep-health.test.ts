import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { databaseHealthy, REQUIRED_DATABASE_RELEASE } from './deep-health';

const env = { url: 'https://database.example.test', serviceRoleKey: 'service-key' };

describe('databaseHealthy', () => {
  it('requires both a database read and the exact release contract', async () => {
    let calls = 0;
    const healthy = await databaseHealthy(env, async (input, init) => {
      calls += 1;
      assert.ok(init.signal);
      if (input.endsWith('/brands?select=id&limit=1')) return new Response('[]');
      assert.ok(input.endsWith('/rpc/platform_release_readiness'));
      assert.equal(init.method, 'POST');
      return Response.json(REQUIRED_DATABASE_RELEASE);
    }, 50);
    assert.equal(healthy, true);
    assert.equal(calls, 2);
  });

  it('retries a stale release and fails closed after two bounded attempts', async () => {
    let calls = 0;
    const healthy = await databaseHealthy(env, async (input, init) => {
      calls += 1;
      assert.ok(init.signal);
      return input.includes('/brands?')
        ? new Response('[]')
        : Response.json('20260824101613');
    }, 50);
    assert.equal(healthy, false);
    assert.equal(calls, 4);
  });

  it('retries transient read failures once', async () => {
    let calls = 0;
    const healthy = await databaseHealthy(env, async () => {
      calls += 1;
      throw new Error('offline');
    }, 50);
    assert.equal(healthy, false);
    assert.equal(calls, 2);
  });
});
