/**
 * Re-onboarding with a smaller menu must take the removed items off the guest
 * menu.
 *
 * `pnpm onboard` is documented as idempotent, and it was -- for additions.
 * seedTenantMenu upserted every row in the current menu.csv and never looked
 * at what else the menu held, so an item the tenant discontinued stayed
 * exactly as it was. The guest app filters `menu_items` on `is_listed`
 * (packages/data/src/menu.ts), so a removed drink stayed orderable
 * indefinitely. Onboarding was also silent about a returning item: the upsert
 * never set `is_listed`, so a row unlisted once stayed unlisted even when it
 * came back to the CSV.
 *
 * A recording client rather than a database: what matters is the exact write
 * the seeder issues, and the seeder has no other seam.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { SupabaseClient } from '@supabase/supabase-js';

import { seedTenantMenu } from './lib/onboard-database-menu';

type Call = { table: string; op: string; payload?: unknown; filters: string[] };

/** Chainable fake: every builder method records and returns itself. */
type ClientOptions = { rows?: { id: string }[]; fail?: 'read' | 'retire' };
function recordingClient(calls: Call[], options: ClientOptions = {}): SupabaseClient {
  const from = (table: string) => {
    const call: Call = { table, op: '', filters: [] };
    calls.push(call);
    const builder: Record<string, unknown> = {};
    for (const op of ['upsert', 'update', 'insert']) {
      builder[op] = (payload: unknown) => { call.op = op; call.payload = payload; return builder; };
    }
    for (const filter of ['eq', 'in', 'select', 'order']) {
      builder[filter] = (...args: unknown[]) => { call.filters.push(`${filter}(${args.map(String).join(',')})`); return builder; };
    }
    builder.single = async () => ({ data: { id: `${table}-id`, slug: (call.payload as { slug?: string })?.slug }, error: null });
    let rangeStart = 0;
    let rangeEnd = 499;
    builder.range = (start: number, end: number) => { rangeStart = start; rangeEnd = end; return builder; };
    builder.then = (resolve: (value: unknown) => void) => {
      const failed = options.fail === (call.op === 'update' ? 'retire' : 'read');
      resolve({
        data: (options.rows ?? [{ id: 'menu_items-id' }, { id: 'retired-id' }]).slice(rangeStart, rangeEnd + 1),
        error: failed ? { message: 'Database unavailable' } : null,
      });
    };
    return builder;
  };
  return { from } as unknown as SupabaseClient;
}

const tenant = {
  menuRows: [
    { slug: 'drip', name: 'Drip', description: '', category: 'Coffee', basePriceCents: 300, sizes: [] },
  ],
  menu: {
    categories: [{ id: 'coffee', title: 'Coffee', tagline: '' }],
    items: [{ id: 'drip' }],
  },
  modifiers: {},
} as unknown as Parameters<typeof seedTenantMenu>[3];

describe('seedTenantMenu retires items that left the menu', () => {
  it('unlists every item in the menu whose slug is not in the current CSV', async () => {
    const calls: Call[] = [];
    await seedTenantMenu(recordingClient(calls), 'brand-1', '/tmp/nowhere', tenant);
    const retire = calls.find((call) => call.table === 'menu_items' && call.op === 'update'
      && (call.payload as { is_listed?: boolean }).is_listed === false);
    assert.ok(retire, 'no unlist pass ran after upserting the current menu');
    assert.ok(retire.filters.includes('eq(brand_id,brand-1)'), 'unlist is not scoped to the brand');
    assert.ok(retire.filters.some((f) => f.startsWith('eq(menu_id,')), 'unlist is not scoped to the menu');
    assert.ok(retire.filters.includes('in(id,retired-id)'), 'only removed IDs should be unlisted');
  });


  it('continues past the first database page without retiring retained items', async () => {
    const calls: Call[] = [];
    const rows = [{ id: 'menu_items-id' }, ...Array.from({ length: 501 }, (_, i) => ({ id: `old-${i}` }))];
    await seedTenantMenu(recordingClient(calls, { rows }), 'brand-1', '/tmp/nowhere', tenant);
    const updates = calls.filter((call) => call.table === 'menu_items' && call.op === 'update');
    assert.equal(updates.length, 2);
    assert.ok(updates[1]?.filters.includes('in(id,old-499,old-500)'));
    assert.ok(updates.every((call) => !call.filters.some((f) => f.includes('menu_items-id'))));
  });

  it('does not update a menu whose items are all retained', async () => {
    const calls: Call[] = [];
    await seedTenantMenu(recordingClient(calls, { rows: [{ id: 'menu_items-id' }] }), 'brand-1', '/tmp/nowhere', tenant);
    assert.equal(calls.filter((call) => call.op === 'update').length, 0);
  });

  for (const fail of ['read', 'retire'] as const) {
    it(`propagates a failed ${fail} instead of reporting onboarding success`, async () => {
      await assert.rejects(seedTenantMenu(recordingClient([], { fail }), 'brand-1', '/tmp/nowhere', tenant),
        { message: 'Database unavailable' });
    });
  }

  it('preserves the optional empty-catalog behavior without database writes', async () => {
    const calls: Call[] = [];
    assert.equal(await seedTenantMenu(recordingClient(calls), 'brand-1', '/tmp/nowhere', { ...tenant, menuRows: [] }), 0);
    assert.equal(calls.length, 0);
  });

  it('lists a returning item explicitly rather than trusting its old state', async () => {
    const calls: Call[] = [];
    await seedTenantMenu(recordingClient(calls), 'brand-1', '/tmp/nowhere', tenant);
    const upsert = calls.find((call) => call.table === 'menu_items' && call.op === 'upsert');
    assert.ok(upsert);
    assert.equal((upsert.payload as { is_listed?: boolean }).is_listed, true);
  });

  it('runs the unlist pass after the upserts, never before', async () => {
    const calls: Call[] = [];
    await seedTenantMenu(recordingClient(calls), 'brand-1', '/tmp/nowhere', tenant);
    const ops = calls.filter((c) => c.table === 'menu_items').map((c) => c.op);
    assert.equal(ops.indexOf('update'), ops.length - 1, 'unlist must be the last menu_items write');
  });
});
