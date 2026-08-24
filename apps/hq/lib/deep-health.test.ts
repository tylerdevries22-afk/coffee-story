import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { databaseHealthy } from './deep-health';

const env = { url: 'https://database.example.test', serviceRoleKey: 'service-key' };

describe('databaseHealthy', () => {
  it('retries one failed read and succeeds on the second', async () => {
    let calls = 0;
    const healthy = await databaseHealthy(env, async () => {
      calls += 1;
      return new Response(null, { status: calls === 1 ? 503 : 200 });
    }, 50);
    assert.equal(healthy, true);
    assert.equal(calls, 2);
  });

  it('fails after two bounded attempts', async () => {
    let calls = 0;
    const healthy = await databaseHealthy(env, async (_input, init) => {
      calls += 1;
      assert.ok(init.signal);
      throw new Error('offline');
    }, 50);
    assert.equal(healthy, false);
    assert.equal(calls, 2);
  });
});
