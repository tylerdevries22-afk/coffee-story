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

function migrationNames(): string[] {
  return readdirSync(MIGRATIONS).filter((name) => name.endsWith('.sql')).sort();
}

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

/**
 * The kiosk reads nothing, and that is the invariant.
 *
 * Three migrations circled this. 0023 gave a lobby tablet SELECT on `orders`
 * for every row at its location for an hour. 0034 (mine) dropped that and
 * added a projection, `kiosk_receipts`. 0038 re-created a policy of the same
 * name -- narrower, but on `orders`, which grants every column of the rows it
 * matches, so it was a step backwards from the projection it did not know had
 * replaced it. 0041 dropped the policy outright and 0042 dropped my view.
 *
 * The reason all three were wrong is the same: `apps/kiosk/src` contains no
 * Supabase client, no `@platform/data` import and no `.from('orders')`. The
 * ticket arrives on the placeOrder response, and a retry with the same
 * Idempotency-Key returns the original order. There is no read to authorise.
 *
 * So the assertion is not "the grant is narrow" but "there is no grant", and
 * it has to be checked as the LAST statement touching each name. Grepping for
 * a `drop` passes while a later `create` puts it back -- which is exactly how
 * 0038 slipped past, and why this walks the sequence.
 */
describe('the lobby kiosk read', () => {
  /** What the migration sequence last did to `name`: 'create', 'drop', or null. */
  function lastVerbFor(name: string, kind: 'policy' | 'view'): string | null {
    const pattern = kind === 'policy'
      ? new RegExp(`(create|drop)\\s+policy(?:\\s+if\\s+exists)?\\s+${name}\\b`, 'gi')
      : new RegExp(`(create|drop)\\s+(?:or\\s+replace\\s+)?view(?:\\s+if\\s+exists)?\\s+public\\.${name}\\b`, 'gi');
    const hits = [...allSql().matchAll(pattern)];
    return hits.length === 0 ? null : (hits[hits.length - 1]?.[1] ?? '').toLowerCase();
  }

  it('ends with no orders policy for an ordering device', () => {
    assert.equal(lastVerbFor('orders_kiosk_select', 'policy'), 'drop',
      'the last statement touching orders_kiosk_select must be a drop; a later '
      + 'create hands a public tablet every column of the rows it matches');
  });

  it('ends with no receipt projection either, because nothing reads one', () => {
    assert.equal(lastVerbFor('kiosk_receipts', 'view'), 'drop',
      'an unread view is still a grant to anon and authenticated');
  });

  it("reads only storefront relations, never a guest's", () => {
    // The structural check under the two above: an assertion about grants is
    // only as good as the assumption that nothing reads.
    //
    // This asserted "no Supabase client in apps/kiosk/src" until the kiosk
    // session pointed out it was broader than the danger it named and
    // collided with the design. docs/FIVE-SURFACES.md gives a kiosk token
    // leave to read the menu, and 0027 put menu_items, menu_categories and
    // drops in the Realtime publication precisely so a change made once
    // reaches every kiosk. Decisive detail: `menu_items_select` admits anyone
    // once a menu is published -- no device claim required -- so a kiosk
    // reading it obtains nothing a lifted tablet could not already get with
    // the anon key that ships in the customer bundle. The client was never
    // the risk; what it reads is.
    //
    // An allowlist rather than a list of forbidden tables: a denylist is one
    // migration behind whoever adds the next relation holding guest data, and
    // this surface is a tablet bolted to a counter in a public room.
    const ALLOWED = new Set([
      'menus', 'menu_categories', 'menu_items', 'menu_item_options',
      'drops', 'locations', 'brand_storefront', 'devices',
    ]);
    const kioskSrc = join(MIGRATIONS, '..', '..', 'apps', 'kiosk', 'src');
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.tsx?$/.test(entry.name)) files.push(full);
      }
    };
    walk(kioskSrc);
    for (const file of files) {
      for (const [, relation] of readFileSync(file, 'utf8').matchAll(/\.from\('([a-z_]+)'\)/g)) {
        assert.ok(ALLOWED.has(relation ?? ''),
          `${file} reads '${relation}'. A kiosk is a public tablet: it may read `
          + 'the storefront and its own device row, and nothing carrying a '
          + "guest's orders, identity, loyalty or money. If this relation is "
          + 'genuinely storefront data, add it to ALLOWED here deliberately.');
      }
    }

    // The same allowlist, applied to reads the kiosk delegates.
    //
    // The direct-`.from` check above went vacuous the moment the kiosk started
    // reading through `@platform/data` -- which is the RIGHT way to read, since
    // it means one assembly of the menu tree instead of a fourth, but it also
    // means zero `.from(` calls in this app and a guard inspecting nothing. It
    // would have passed just as happily on `fetchCustomerOrders`.
    //
    // So the reader's own relations are attributed to it. Granularity is the
    // file: every relation named in a `@platform/data` module counts against
    // every export from that module. That over-approximates -- an unrelated
    // function next door can fail the check -- and that is the bias a guard on
    // a public tablet should have. Splitting the module is the fix, not
    // widening the list.
    //
    // Known limit, stated rather than implied: this follows one hop. A kiosk
    // file importing a *local* module that itself imports @platform/data is
    // not attributed, so this is a speed bump against accident, not a proof
    // against intent. Closing it needs a module-graph walk; the direct and
    // one-hop-delegated paths are the ones anyone reaches for by accident.
    const dataSrc = join(MIGRATIONS, '..', '..', 'packages', 'data', 'src');
    const relationsByExport = new Map<string, Set<string>>();
    for (const entry of readdirSync(dataSrc)) {
      if (!/\.ts$/.test(entry) || /\.test\.ts$/.test(entry)) continue;
      const source = readFileSync(join(dataSrc, entry), 'utf8');
      const relations = new Set(
        [...source.matchAll(/\.from\('([a-z_]+)'\)/g)].map(([, name]) => name ?? ''),
      );
      for (const [, name] of source.matchAll(/export\s+(?:async\s+)?function\s+(\w+)/g)) {
        if (name) relationsByExport.set(name, relations);
      }
    }

    for (const file of files) {
      const source = readFileSync(file, 'utf8');

      // A namespace import defeats the clause parsing below: `import * as data`
      // then `data.fetchCustomerOrders(...)` names nothing this can attribute,
      // so the check would pass while the read happened. Named imports are a
      // precondition for the guard being able to see anything, so require them
      // rather than trying to resolve member expressions.
      assert.doesNotMatch(source, /import\s+\*\s+as\s+\w+\s+from\s*'@platform\/data'/,
        `${file} namespace-imports @platform/data. Use named imports here: the `
        + 'allowlist attributes a reader\'s relations by name, and a namespace '
        + 'import hides which ones are used.');

      for (const [, clause] of source.matchAll(/import\s*\{([^}]*)\}\s*from\s*'@platform\/data'/g)) {
        for (const raw of (clause ?? '').split(',')) {
          const name = raw.replace(/^\s*type\s+/, '').split(/\s+as\s+/)[0]?.trim() ?? '';
          if (name === '') continue;
          for (const relation of relationsByExport.get(name) ?? []) {
            assert.ok(ALLOWED.has(relation),
              `${file} imports ${name} from @platform/data, which reads `
              + `'${relation}'. A kiosk is a public tablet: reading through a `
              + 'shared package does not widen what it may read.');
          }
        }
      }
    }
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

  it('records which device took an order, without granting the device access', () => {
    // The column is ATTRIBUTION -- which till rang which sale. It is not a
    // grant, and the next assertion is what keeps those two apart.
    assert.match(allSql(), /add column device_id uuid references public\.devices/);
    assert.match(typesSource(), /device_id: string \| null/);
  });

  it('leaves no client policy granting a device access to public.orders', () => {
    /**
     * A policy on `orders` grants every COLUMN of the rows it matches, so a
     * kiosk token would carry customer_id, totals, note and square_payment_id
     * for those rows -- on a tablet bolted to a counter in a public room. 0034
     * replaced the policy with a projection for exactly that reason; 0038
     * re-created it by accident, and 0041 drops it again.
     *
     * The kiosk needs nothing here: it holds no Supabase client and reads its
     * ticket from the placeOrder response. This asserts the LAST statement
     * touching the policy is a drop, which is the only way to state "no grant"
     * in a tree of additive migrations.
     */
    const events: { kind: 'create' | 'drop'; at: number }[] = [];
    for (const [index, name] of migrationNames().entries()) {
      const sql = readFileSync(join(MIGRATIONS, name), 'utf8');
      for (const match of sql.matchAll(/(create|drop)\s+policy(?:\s+if\s+exists)?\s+orders_kiosk_select/gi)) {
        events.push({ kind: match[1]!.toLowerCase() as 'create' | 'drop', at: index });
      }
    }
    assert.ok(events.length > 0, 'expected the policy to appear in the history at all');
    assert.equal(
      events.at(-1)?.kind, 'drop',
      'the last word on orders_kiosk_select must be a drop: a device gets no row-level access to orders',
    );
  });
});
