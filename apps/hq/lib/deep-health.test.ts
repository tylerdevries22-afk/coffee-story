import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

import { databaseHealthy, databaseReadable, REQUIRED_DATABASE_RELEASE } from './deep-health';

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

  /**
   * A refused read with a healthy release is the shape that matters: the RPC
   * answers correctly because the function is there, while the REST edge is
   * rejecting the service key. Without the guard the probe reports healthy on
   * a database no route can actually read from, since it only ever looks at
   * the release. Found by mutation -- deleting the check left every other test
   * here passing, because none of them had a read that failed without throwing.
   */
  it('does not accept a healthy release from a database it cannot read', async () => {
    let readinessAsked = 0;
    const healthy = await databaseHealthy(env, async (input) => {
      if (input.includes('/brands?')) return new Response('forbidden', { status: 401 });
      readinessAsked += 1;
      return Response.json(REQUIRED_DATABASE_RELEASE);
    }, 50);
    assert.equal(healthy, false);
    assert.equal(readinessAsked, 0, 'the release was consulted despite an unreadable database');
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

describe('databaseReadable', () => {
  const publishable = { url: 'https://database.example.test', key: 'publishable-key' };

  /**
   * The point of the split: a public page must be able to report a real
   * dependency without holding the service-role key, and without asking for
   * `platform_release_readiness`, which is revoked from anon.
   */
  it('reads the named resource with the caller\'s own key and asks for nothing else', async () => {
    const paths: string[] = [];
    const readable = await databaseReadable(publishable, 'board_tickets?select=order_number&limit=1', async (input, init) => {
      paths.push(input);
      assert.ok(init.signal);
      assert.equal((init.headers as Record<string, string>).apikey, 'publishable-key');
      return new Response('[]');
    }, 50);
    assert.equal(readable, true);
    assert.deepEqual(paths, ['https://database.example.test/rest/v1/board_tickets?select=order_number&limit=1']);
  });

  /**
   * RLS returning no rows to an anonymous reader is the boundary working. A
   * probe that treated an empty result as an outage would light the status
   * page red on a perfectly healthy platform.
   */
  it('treats an empty RLS-filtered result as a healthy edge', async () => {
    assert.equal(await databaseReadable(publishable, 'board_tickets?select=order_number&limit=1',
      async () => Response.json([]), 50), true);
  });

  it('retries once and then fails closed on a refusal', async () => {
    let calls = 0;
    const readable = await databaseReadable(publishable, 'brands?select=id&limit=1', async () => {
      calls += 1;
      return new Response('forbidden', { status: 403 });
    }, 50);
    assert.equal(readable, false);
    assert.equal(calls, 2);
  });

  it('retries once and then fails closed on a thrown request', async () => {
    let calls = 0;
    const readable = await databaseReadable(publishable, 'brands?select=id&limit=1', async () => {
      calls += 1;
      throw new Error('offline');
    }, 50);
    assert.equal(readable, false);
    assert.equal(calls, 2);
  });
});
