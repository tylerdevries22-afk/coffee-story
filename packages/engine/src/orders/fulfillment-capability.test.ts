import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { SupabaseClient } from '@supabase/supabase-js';

import { createOrder } from './create-order';
import { OrderError, type CreateOrderInput } from './types';

const BRAND_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const LOCATION_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const MENU_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

const MENU_ITEM = {
  id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  slug: 'drip-coffee',
  name: 'Drip Coffee',
  base_price_cents: 500,
  sizes: null,
  modifiers: null,
  menu_id: MENU_ID,
  pack_size: null,
  choice_source: null,
  pack_choice_slugs: [],
};

const COMMITTED = {
  order: {
    id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
    status: 'created',
    subtotal_cents: 500,
    tax_cents: 15,
    tip_cents: 0,
    total_cents: 515,
    daily_number: 7,
  },
  replayed: false,
};

function inputFor(fulfillmentType: CreateOrderInput['fulfillmentType']): CreateOrderInput {
  return {
    brandId: BRAND_ID,
    locationId: LOCATION_ID,
    customerId: null,
    actorUserId: null,
    fulfillmentType,
    scheduledFor: null,
    note: '',
    lines: [{ itemSlug: 'drip-coffee', quantity: 1 }],
    tipCents: 0,
    tenderType: 'pay_at_pickup',
    channel: 'web',
    guestLabel: 'Ada',
    deviceId: null,
    clientKey: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    taxJurisdictions: [{ id: 'state', label: 'State', rate: 0.03 }],
  };
}

class StubQuery {
  private readonly filters = new Map<string, unknown>();

  constructor(private readonly database: StubDatabase, private readonly table: string) {}
  select(): this { return this; }
  in(): this { return this; }
  eq(column: string, value: unknown): this { this.filters.set(column, value); return this; }

  async maybeSingle<T>(): Promise<{ data: T | null; error: unknown }> {
    if (this.table === 'locations') {
      return { data: { id: LOCATION_ID, ordering_paused: false } as T, error: null };
    }
    if (this.database.installationReadFails) {
      return { data: null, error: { code: '08006', message: 'connection failure' } };
    }
    // Only an active installation of the exact module grants, so a suspended
    // row or a different module reads the same as no row at all.
    const moduleKey = String(this.filters.get('module_key'));
    const granted = this.filters.get('brand_id') === BRAND_ID
      && this.filters.get('state') === 'active'
      && this.database.activeModules.has(moduleKey);
    return { data: granted ? ({ module_key: moduleKey } as T) : null, error: null };
  }

  async returns<T>(): Promise<{ data: T; error: unknown }> {
    return { data: (this.table === 'menus' ? [{ id: MENU_ID }] : [MENU_ITEM]) as T, error: null };
  }
}

class StubDatabase {
  readonly tables: string[] = [];
  readonly committed: Record<string, unknown>[] = [];
  installationReadFails = false;

  constructor(readonly activeModules: ReadonlySet<string>) {}

  from(table: string): StubQuery {
    this.tables.push(table);
    return new StubQuery(this, table);
  }

  async rpc(name: string, args: Record<string, unknown>): Promise<{ data: unknown; error: unknown }> {
    if (name === 'resolve_order_replay') return { data: null, error: null };
    this.committed.push(args);
    return { data: COMMITTED, error: null };
  }

  asClient(): SupabaseClient {
    return this as unknown as SupabaseClient;
  }
}

describe('createOrder fulfillment capability', () => {
  it('refuses catering when the brand holds no catering installation', async () => {
    const database = new StubDatabase(new Set());
    await assert.rejects(createOrder({ db: database.asClient() }, inputFor('catering')), (error: unknown) => {
      assert.ok(error instanceof OrderError);
      assert.equal(error.code, 'fulfillment_unavailable');
      return true;
    });
    assert.deepEqual(database.committed, []);
    // Refused before the catalog is read, so an ungranted type costs no pricing work.
    assert.equal(database.tables.includes('menu_items'), false);
  });

  it('refuses delivery to a brand that installed only catering', async () => {
    const database = new StubDatabase(new Set(['commerce-catering']));
    await assert.rejects(
      createOrder({ db: database.asClient() }, inputFor('delivery')),
      (error: unknown) => error instanceof OrderError && error.code === 'fulfillment_unavailable',
    );
    assert.deepEqual(database.committed, []);
  });

  it('commits catering when the brand holds the catering module', async () => {
    const database = new StubDatabase(new Set(['commerce-catering']));
    const result = await createOrder({ db: database.asClient() }, inputFor('catering'));
    assert.equal(result.orderId, COMMITTED.order.id);
    assert.equal(database.committed.length, 1);
    assert.equal(database.committed[0]?.p_fulfillment_type, 'catering');
  });

  it('leaves pickup alone, installed or not, and spends no round trip on it', async () => {
    for (const modules of [new Set<string>(), new Set(['commerce-catering'])]) {
      const database = new StubDatabase(modules);
      const result = await createOrder({ db: database.asClient() }, inputFor('pickup'));
      assert.equal(result.orderId, COMMITTED.order.id);
      assert.equal(database.committed[0]?.p_fulfillment_type, 'pickup');
      assert.equal(database.tables.includes('module_installations'), false);
    }
  });

  it('denies rather than grants when the installation read fails', async () => {
    const database = new StubDatabase(new Set(['commerce-catering']));
    database.installationReadFails = true;
    await assert.rejects(createOrder({ db: database.asClient() }, inputFor('catering')));
    assert.deepEqual(database.committed, []);
  });
});
