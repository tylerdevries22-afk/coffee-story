import assert from 'node:assert/strict';
import { it } from 'node:test';

import type { SupabaseClient } from '@supabase/supabase-js';

import { runSquareMaintenance } from './square-job-maintenance';

class EmptyQuery {
  select() { return this; }
  not() { return this; }
  lte() { return this; }
  or() { return this; }
  order() { return this; }
  limit() { return this; }
  async returns<T>() { return { data: [] as T, error: null }; }
}

it('reports optional Square maintenance as unconfigured without credentials', async (t) => {
  const appId = process.env.SQUARE_APP_ID;
  const secret = process.env.SQUARE_APP_SECRET;
  delete process.env.SQUARE_APP_ID;
  delete process.env.SQUARE_APP_SECRET;
  t.after(() => {
    if (appId === undefined) delete process.env.SQUARE_APP_ID;
    else process.env.SQUARE_APP_ID = appId;
    if (secret === undefined) delete process.env.SQUARE_APP_SECRET;
    else process.env.SQUARE_APP_SECRET = secret;
  });
  t.mock.method(console, 'warn', () => {});

  const result = await runSquareMaintenance({} as SupabaseClient, new Date());

  assert.equal(result.configured, false);
  assert.equal(result.checkoutLinks.scanned, 0);
  assert.equal(result.cardPayments.scanned, 0);
  assert.equal(result.retirements.scanned, 0);
});

it('runs every configured Square lifecycle scan and combines its results', async (t) => {
  const keys = ['SQUARE_APP_ID', 'SQUARE_APP_SECRET', 'SQUARE_TOKEN_KEY'] as const;
  const original = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  process.env.SQUARE_APP_ID = 'app';
  process.env.SQUARE_APP_SECRET = 'secret';
  process.env.SQUARE_TOKEN_KEY = Buffer.alloc(32, 7).toString('base64');
  t.after(() => {
    for (const key of keys) {
      const value = original[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  const calls: string[] = [];
  const db = {
    from: (table: string) => {
      calls.push(table);
      return new EmptyQuery();
    },
    rpc: async (name: string) => {
      calls.push(name);
      return { data: [], error: null };
    },
  } as unknown as SupabaseClient;

  const result = await runSquareMaintenance(db, new Date('2026-09-08T18:00:00.000Z'));

  assert.equal(result.configured, true);
  assert.deepEqual(calls, [
    'square_connections',
    'square_access_token_retirements',
    'claim_due_square_checkout_quotes',
    'claim_due_square_card_quotes',
  ]);
  assert.equal(result.scanned, 0);
  assert.equal(result.retirements.scanned, 0);
  assert.equal(result.checkoutLinks.scanned, 0);
  assert.equal(result.cardPayments.scanned, 0);
});
