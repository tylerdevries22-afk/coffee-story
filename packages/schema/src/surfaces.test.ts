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
    const roles = [...declared[1]!.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort();
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

/**
 * The view's output columns, by the name a caller would see.
 *
 * Substring-matching the whole definition was the obvious check and it is
 * wrong in both directions: it misses a column smuggled in under an alias, and
 * since 0030 it false-positives on `app.loyalty_tier_for(o.customer_id, ...)`
 * -- an argument handed to a definer function, which is the opposite of an
 * exposed column. What a bystander can read is the select list, so that is
 * what gets checked.
 */
function projectedColumns(view: string): string[] {
  const body = /\bas\s+select\b([\s\S]*?)\bfrom\b/i.exec(view);
  if (!body) return [];
  const columns: string[] = [];
  let depth = 0;
  let current = '';
  for (const character of body[1] ?? '') {
    if (character === '(') depth += 1;
    if (character === ')') depth -= 1;
    if (character === ',' && depth === 0) {
      columns.push(current);
      current = '';
      continue;
    }
    current += character;
  }
  columns.push(current);
  return columns.map((column) => {
    const trimmed = column.trim();
    const aliased = /\bas\s+([a-z_][a-z0-9_]*)$/i.exec(trimmed);
    if (aliased) return (aliased[1] ?? '').toLowerCase();
    return (trimmed.split('.').pop() ?? trimmed).toLowerCase();
  }).filter(Boolean);
}

function boardTicketsInForce(): string {
  // Take the definition actually in force -- 0028 and then 0030 redefine it.
  const views = [...allSql().matchAll(/create (?:or replace )?view public\.board_tickets[\s\S]*?;/g)];
  assert.ok(views.length > 0, 'board_tickets is not defined');
  return views[views.length - 1]?.[0] ?? '';
}

describe('the pickup display read', () => {
  it('exposes no customer or money columns', () => {
    const columns = projectedColumns(boardTicketsInForce());
    for (const forbidden of [
      'customer_id', 'totals', 'total_cents', 'subtotal_cents', 'tax_cents',
      'tip_cents', 'square_payment_id', 'square_order_id', 'note',
      'points_balance', 'lifetime_points',
    ]) {
      assert.ok(!columns.includes(forbidden),
        `board_tickets must not expose ${forbidden}: a wall screen is not a private surface`);
    }
    assert.ok(columns.includes('daily_number'));
    assert.ok(columns.includes('guest_label'));
  });

  it('carries its own authorization rather than leaning on a policy', () => {
    // 0023 shipped this view as security_invoker alongside a SELECT policy on
    // `orders` itself -- and 0014 grants every column of every table to
    // `authenticated`, so the narrow projection was advisory. A wall tablet's
    // token could read the cart. The gate has to be inside the view.
    const inForce = boardTicketsInForce();
    assert.match(inForce, /app\.can_read_board/,
      'board_tickets must gate itself');
    assert.doesNotMatch(inForce, /security_invoker\s*=\s*true/,
      'an invoker view cannot reach loyalty_accounts to compute a tier');
    assert.match(allSql(), /drop policy if exists orders_display_select on public\.orders/,
      'a display device must have no direct read on orders');
  });

  it('lets a tier through as a bucket and never as a balance', () => {
    const fn = /create or replace function app\.loyalty_tier_for[\s\S]*?\$\$;/.exec(allSql());
    assert.ok(fn, 'app.loyalty_tier_for is not defined');
    assert.match(fn[0], /security definer/, 'a display device cannot read loyalty_accounts');
    assert.match(fn[0], /showGuestStatus/,
      'a tier badge on a public wall must be opt-in per brand');
    assert.match(fn[0], /returns text/, 'only the slug may leave this function');
  });
});

describe('the lobby kiosk read', () => {
  it('leaves an ordering device no route to orders either', () => {
    // Same shape as the display policy 0033 dropped, on a surface just as
    // public: `orders_kiosk_select` granted SELECT on `orders` -- every column,
    // every row at that location, for a rolling hour -- to a tablet bolted to
    // a counter anyone can reach. 0034 replaced it with a projection.
    assert.match(allSql(), /drop policy if exists orders_kiosk_select on public\.orders/);
  });

  it('hands a receipt a number and a name, and nothing that costs money', () => {
    const views = [...allSql().matchAll(
      /create (?:or replace )?view public\.kiosk_receipts[\s\S]*?;/g)];
    assert.ok(views.length > 0, 'kiosk_receipts is not defined');
    const columns = projectedColumns(views[views.length - 1]![0]);
    assert.ok(columns.includes('daily_number'));
    for (const forbidden of ['customer_id', 'totals', 'total_cents', 'note', 'square_payment_id']) {
      assert.ok(!columns.includes(forbidden), `kiosk_receipts must not expose ${forbidden}`);
    }
  });

  it('bounds the window, because a kiosk cannot prove which order is its own', () => {
    const fn = /create or replace function app\.can_read_receipt[\s\S]*?\$\$;/.exec(allSql());
    assert.ok(fn, 'app.can_read_receipt is not defined');
    assert.match(fn[0], /device_is_active\('kiosk'\)/);
    assert.match(fn[0], /jwt_device_location\(\)/, 'must be scoped to the device location');
    assert.match(allSql(), /created_at > now\(\) - interval '10 minutes'/,
      'the receipt window is the containment; it must stay short');
  });
});

describe('the lineup', () => {
  it('agrees with the TS DropStatus union', () => {
    const sql = allSql();
    const constraints = [...sql.matchAll(/constraint drops_status_check[\s\S]*?check \(status in \(([^)]+)\)\)/g)];
    assert.ok(constraints.length > 0, 'drops_status_check is not declared');
    const statuses = [...constraints[constraints.length - 1]![1]!.matchAll(/'([a-z]+)'/g)]
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

describe('device pairing became issuable (0038)', () => {
  /**
   * 0022 built the readers and 0009's hook never emitted the claims they read,
   * so `app.device_is_active()` was false for every token the platform could
   * issue. These assert the schema half of the fix; the minter itself is
   * covered by packages/engine/src/devices.test.ts.
   */
  it('stores a pairing code hashed, and no longer stores it in the clear', () => {
    const sql = allSql();
    assert.match(sql, /add column pairing_code_hash text/, 'the hash column must exist');
    assert.match(sql, /drop column pairing_code\b/, 'the plaintext column must be dropped');
    // devices_select is brand-wide and includes role 'staff', so a readable
    // code let any barista pair hardware at any of the brand's stores.
    assert.match(typesSource(), /pairing_code_hash: string \| null/);
    assert.doesNotMatch(typesSource(), /^\s+pairing_code: string/m, 'types must not resurrect the plaintext column');
  });

  it('carries a token version, so revocation bites on the service-role path', () => {
    assert.match(allSql(), /add column token_version integer not null default 1/);
    assert.match(typesSource(), /token_version: number/);
  });

  it('protects a device lifecycle from a signed-in client', () => {
    const sql = allSql();
    assert.match(sql, /create or replace function app\.protect_device_lifecycle\(\)/);
    assert.match(sql, /create trigger devices_protect_lifecycle\s+before insert or update on public\.devices/);
    // Same shape as app.protect_fee_terms: the service role has no jwt_role,
    // so the engine is unaffected and only a person is constrained.
    assert.match(sql, /if app\.jwt_role\(\) is not null then/);
    for (const column of ['revoked_at', 'paired_at', 'token_version', 'pairing_code_hash']) {
      assert.ok(
        new RegExp(`new\\.${column} is distinct from old\\.${column}`).test(sql),
        `${column} must be protected from a client write`,
      );
    }
  });

  it('narrows a kiosk read to its own orders, matching what 0023 claimed', () => {
    const sql = allSql();
    assert.match(sql, /add column device_id uuid references public\.devices/);
    assert.match(typesSource(), /device_id: string \| null/);
    // The in-force policy is the LAST definition, since 0038 redefines 0023's.
    const policies = [...sql.matchAll(/create policy orders_kiosk_select on public\.orders for select\s+using \(([\s\S]*?)\);/g)];
    const inForce = policies.at(-1)?.[1] ?? '';
    assert.ok(inForce.length > 0, 'orders_kiosk_select must exist');
    assert.match(inForce, /device_id = app\.jwt_device_id\(\)/,
      'a kiosk must read only its own orders, not every order at the location');
  });
});
