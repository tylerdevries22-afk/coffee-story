import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

import { databaseHealthy, REQUIRED_DATABASE_RELEASE } from './deep-health';

const env = { url: 'https://database.example.test', serviceRoleKey: 'service-key' };

const MIGRATIONS = join(dirname(fileURLToPath(import.meta.url)), '../../../supabase/migrations');

describe('REQUIRED_DATABASE_RELEASE', () => {
  /**
   * Every other test in this file feeds the constant back to itself, so a
   * stale value passes them all -- and one did, three releases out of date,
   * which fails the deep health probe against a correctly migrated database.
   *
   * This derives the expectation the way verify.yml derives its own: the
   * timestamp prefix of the newest migration filename, which is what the
   * readiness chain returns once that migration is applied. Adding a migration
   * without moving the constant now fails here rather than in production.
   */
  it('names the newest migration, the way the release gate computes it', () => {
    const newest = readdirSync(MIGRATIONS)
      .filter((name) => name.endsWith('.sql'))
      .sort()
      .at(-1);
    assert.ok(newest, 'no migrations found');
    assert.equal(REQUIRED_DATABASE_RELEASE, newest.split('_')[0]);
  });
});

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
