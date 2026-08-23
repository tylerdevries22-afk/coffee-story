import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';

/**
 * The five-surface additions, checked against the SQL that defines them.
 *
 * types.ts is hand-authored against the migrations, so nothing stops the two
 * drifting except a test that reads both. This follows order-status.test.ts:
 * find the migration actually in force rather than pinning a filename, since a
 * later migration may redefine what an earlier one created.
 */
const MIGRATIONS = join(dirname(fileURLToPath(import.meta.url)), '../../../supabase/migrations');

function allSql(): string {
  return readdirSync(MIGRATIONS)
    .filter((name) => name.endsWith('.sql'))
    .sort()
    .map((name) => readFileSync(join(MIGRATIONS, name), 'utf8'))
    .join('\n');
}

function typesSource(): string {
  return readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'types.ts'), 'utf8');
}

describe('device pairing', () => {
  it('declares every device role the TS union carries', () => {
    const sql = allSql();
    const declared = /create type app\.device_role as enum \(([^)]+)\)/.exec(sql);
    assert.ok(declared, 'app.device_role is not declared');
    const roles = [...declared[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort();
    assert.deepEqual(roles, ['display', 'kiosk', 'pos', 'prep']);
    for (const role of roles) {
      assert.match(typesSource(), new RegExp(`DeviceRole =[^;]*'${role}'`, 's'),
        `DeviceRole is missing ${role}`);
    }
  });

  it('never lets a device token satisfy a staff policy', () => {
    // The claim set a device carries has no `role`, so app.jwt_role() is null
    // for it and every is_brand_* helper fails. That is the whole security
    // argument, so it must stay true in the SQL: no device helper may consult
    // the staff role.
    const sql = allSql();
    const deviceFns = /create or replace function app\.device_is_active[\s\S]*?\$\$;/.exec(sql);
    assert.ok(deviceFns, 'app.device_is_active is not defined');
    assert.doesNotMatch(deviceFns[0], /jwt_role\(\)/,
      'device_is_active must not consult the staff role claim');
  });

  it('fails closed on a revoked device', () => {
    const sql = allSql();
    const fn = /create or replace function app\.device_is_active[\s\S]*?\$\$;/.exec(sql);
    assert.ok(fn);
    assert.match(fn[0], /revoked_at is null/, 'a revoked device must not be active');
    assert.match(fn[0], /paired_at is not null/, 'an unpaired device must not be active');
  });
});

describe('the pickup display read', () => {
  it('exposes no customer or money columns', () => {
    const sql = allSql();
    // Take the definition actually in force -- 0028 redefines the view.
    const views = [...sql.matchAll(/create or replace view public\.board_tickets[\s\S]*?;/g)];
    assert.ok(views.length > 0, 'board_tickets is not defined');
    const inForce = views[views.length - 1][0];
    for (const forbidden of ['customer_id', 'totals', 'total_cents', 'square_payment_id', 'note']) {
      assert.ok(!inForce.includes(forbidden),
        `board_tickets must not expose ${forbidden}: a wall screen is not a private surface`);
    }
    assert.match(inForce, /daily_number/);
    assert.match(inForce, /guest_label/);
  });
});

describe('the lineup', () => {
  it('agrees with the TS DropStatus union', () => {
    const sql = allSql();
    const constraints = [...sql.matchAll(/constraint drops_status_check[\s\S]*?check \(status in \(([^)]+)\)\)/g)];
    assert.ok(constraints.length > 0, 'drops_status_check is not declared');
    const statuses = [...constraints[constraints.length - 1][1].matchAll(/'([a-z]+)'/g)]
      .map((m) => m[1]).sort();
    assert.deepEqual(statuses, ['cancelled', 'draft', 'ended', 'live', 'revealed', 'scheduled']);
    for (const status of statuses) {
      assert.match(typesSource(), new RegExp(`DropStatus =[^;]*'${status}'`, 's'),
        `DropStatus is missing ${status}`);
    }
  });

  it('cannot reveal a drop after it has already opened', () => {
    assert.match(allSql(), /reveal_at is null or reveal_at <= starts_at/);
  });

  it('carries a weekday exactly when an item is day-specific', () => {
    assert.match(allSql(), /\(rotation = 'day_specific'\) = \(weekday is not null\)/);
  });
});

describe('packs', () => {
  it('requires a choice source whenever a pack size is set', () => {
    assert.match(allSql(), /\(pack_size is null\) = \(choice_source is null\)/);
  });

  it('excludes 86d items from a pack\'s choices', () => {
    const sql = allSql();
    const fn = /create or replace function app\.pack_choices[\s\S]*?\$\$;/.exec(sql);
    assert.ok(fn, 'app.pack_choices is not defined');
    assert.match(fn[0], /not mi\.is_86d/,
      'a sold-out item must not be selectable inside a pack');
  });
});

describe('curbside arrival', () => {
  it('is a column and an event, never a status transition', () => {
    const sql = allSql();
    assert.match(sql, /add column arrived_at timestamptz/);
    // If arrival were a status it would need an edge in the machine; the
    // absence of one here is the invariant worth pinning.
    const transitions = /order_transition_allowed[\s\S]*?\$\$/.exec(sql);
    assert.ok(transitions);
    assert.doesNotMatch(transitions[0], /arrived/,
      'arrival must not appear in the order state machine');
  });

  it('lets a guest mark arrival without granting a status write', () => {
    const sql = allSql();
    const fn = /create or replace function public\.mark_order_arrived[\s\S]*?\$\$;/.exec(sql);
    assert.ok(fn, 'mark_order_arrived is not defined');
    assert.match(fn[0], /c\.user_id = auth\.uid\(\)/, 'must check the caller owns the order');
    assert.match(fn[0], /fulfillment_type = 'curbside'/, 'must only apply to curbside');
  });
});

describe('realtime propagation', () => {
  it('publishes the tables a running screen depends on', () => {
    const sql = allSql();
    for (const table of ['menu_items', 'menu_categories', 'drops', 'prep_batches']) {
      assert.match(sql, new RegExp(`add table public\\.${table}`),
        `${table} must be in supabase_realtime or a live screen never sees a change`);
    }
  });
});
