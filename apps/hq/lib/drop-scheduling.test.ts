import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { SupabaseClient } from '@supabase/supabase-js';

import type { SessionInfo } from './demo-data';
import { scheduleDrop, type ScheduleDropContext } from './drop-scheduling';
import type { DropInput } from './drop-input';

const BRAND = '11111111-1111-4111-8111-111111111111';
const ITEM = '22222222-2222-4222-8222-222222222222';
const owner: SessionInfo = { userId: 'u1', email: 'owner@example.test', role: 'brand_owner', brandId: BRAND, brandName: 'Harbor' };
const staff: SessionInfo = { ...owner, role: 'staff' };
const GOOD_INPUT: DropInput = { itemId: ITEM, startsAt: '2026-10-01T09:00', endsAt: '2026-10-05T21:00' };

type Query = { data: { id: string } | null; error: { message: string } | null };

/** A menu_items/drops pair minimal enough to drive scheduleDrop's two reads. */
function fakeClient(options: {
  readonly item?: Query;
  readonly insert?: Query;
  readonly eqCalls?: [string, string][];
  readonly insertedRow?: Record<string, unknown>;
}): SupabaseClient {
  const item = options.item ?? { data: { id: ITEM }, error: null };
  const insert = options.insert ?? { data: { id: 'drop-1' }, error: null };
  const menuItems = {
    select: () => menuItems,
    eq: (column: string, value: string) => { options.eqCalls?.push([column, value]); return menuItems; },
    maybeSingle: async () => item,
  };
  const drops = {
    insert: (row: Record<string, unknown>) => {
      if (options.insertedRow) Object.assign(options.insertedRow, row);
      return drops;
    },
    select: () => drops,
    maybeSingle: async () => insert,
  };
  return { from: (table: string) => (table === 'menu_items' ? menuItems : drops) } as unknown as SupabaseClient;
}

const context = (overrides: Partial<ScheduleDropContext> = {}): ScheduleDropContext => ({
  session: owner, brandId: BRAND, dropsEnabled: true, client: fakeClient({}), ...overrides,
});

describe('scheduleDrop', () => {
  it('refuses when nobody is signed in, without touching the client', async () => {
    const state = await scheduleDrop(context({ session: null }), GOOD_INPUT);
    assert.equal(state.kind, 'error');
    assert.match(state.message, /brand owner/);
  });

  it('refuses staff below brand_owner', async () => {
    const state = await scheduleDrop(context({ session: staff }), GOOD_INPUT);
    assert.equal(state.kind, 'error');
    assert.match(state.message, /brand owner/);
  });

  it('surfaces the parser error for invalid input instead of reaching the client', async () => {
    const eqCalls: [string, string][] = [];
    const state = await scheduleDrop(
      context({ client: fakeClient({ eqCalls }) }),
      { ...GOOD_INPUT, endsAt: GOOD_INPUT.startsAt },
    );
    assert.equal(state.kind, 'error');
    assert.match(state.message, /end after it starts/);
    assert.equal(eqCalls.length, 0, 'an invalid draft must not query menu_items');
  });

  it('refuses when the drops module is not active for the brand', async () => {
    const state = await scheduleDrop(context({ dropsEnabled: false }), GOOD_INPUT);
    assert.equal(state.kind, 'error');
    assert.match(state.message, /not enabled/);
  });

  it('refuses when the deployment has no Supabase client', async () => {
    const state = await scheduleDrop(context({ client: null }), GOOD_INPUT);
    assert.equal(state.kind, 'error');
    assert.match(state.message, /not connected to Supabase/);
  });

  it('refuses an item id that does not belong to this brand', async () => {
    const state = await scheduleDrop(
      context({ client: fakeClient({ item: { data: null, error: null } }) }),
      GOOD_INPUT,
    );
    assert.equal(state.kind, 'error');
    assert.match(state.message, /Choose a menu item from this brand/);
  });

  it('reports a failed insert as a scheduling failure', async () => {
    const state = await scheduleDrop(
      context({ client: fakeClient({ insert: { data: null, error: { message: 'db down' } } }) }),
      GOOD_INPUT,
    );
    assert.equal(state.kind, 'error');
    assert.match(state.message, /could not be scheduled/);
  });

  it('scopes the menu item lookup to the caller\'s own brand', async () => {
    const eqCalls: [string, string][] = [];
    await scheduleDrop(context({ client: fakeClient({ eqCalls }) }), GOOD_INPUT);
    assert.deepEqual(eqCalls, [['brand_id', BRAND], ['id', ITEM]]);
  });

  it('inserts a scheduled row scoped to the brand and reports success', async () => {
    const insertedRow: Record<string, unknown> = {};
    const state = await scheduleDrop(context({ client: fakeClient({ insertedRow }) }), GOOD_INPUT);
    assert.equal(state.kind, 'success');
    assert.equal(insertedRow.brand_id, BRAND);
    assert.equal(insertedRow.item_id, ITEM);
    assert.equal(insertedRow.status, 'scheduled');
    assert.equal(insertedRow.starts_at, new Date(GOOD_INPUT.startsAt as string).toISOString());
  });
});
