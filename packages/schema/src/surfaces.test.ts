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

/** The last CREATE OR REPLACE body is what PostgreSQL keeps after migrations. */
function functionInForce(schema: string, name: string): string {
  const definitions = [...allSql().matchAll(new RegExp(
    `create or replace function ${schema}\\.${name}\\b[\\s\\S]*?\\$\\$;`,
    'g',
  ))];
  assert.ok(definitions.length > 0, `${schema}.${name} is not defined`);
  return definitions[definitions.length - 1]?.[0] ?? '';
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
    // 0023 shipped this view alongside a SELECT policy on `orders` itself --
    // and 0014 grants every column of every table to `authenticated`, so the
    // narrow projection was advisory. The public view is now invoker-safe and
    // delegates its exceptional base-table read to an unexposed helper.
    const inForce = boardTicketsInForce();
    assert.match(inForce, /app\.can_read_board/,
      'board_tickets must gate itself');
    assert.match(inForce, /security_invoker\s*=\s*true/,
      'a public view must enforce caller privileges');
    const helper = /create or replace function app\.board_ticket_rows[\s\S]*?\$\$;/.exec(allSql());
    assert.ok(helper, 'the private board projection helper is not defined');
    assert.match(helper[0], /security definer/,
      'the helper must own the narrow read after direct orders access is removed');
    assert.match(helper[0], /app\.can_read_board/,
      'the privileged helper must repeat the authorization gate');
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

  it('stores a bounded, non-empty, duplicate-free authored choice set only on packs', () => {
    const sql = allSql();
    assert.match(sql,
      /\(pack_size is null\) = \(cardinality\(pack_choice_slugs\) = 0\)/,
      'packs must have choices and ordinary items must not carry them');
    assert.match(sql, /cardinality\(pack_choice_slugs\) <= 100/);
    assert.match(sql, /app\.valid_slug_set\(pack_choice_slugs\)/,
      'the database must reject empty, whitespace-padded and duplicate slugs');
  });

  it('excludes 86d items from a pack\'s choices', () => {
    const fn = functionInForce('app', 'pack_choices');
    assert.match(fn, /not mi\.is_86d/,
      'a sold-out item must not be selectable inside a pack');
  });

  it('intersects live availability with the exact authored set and tenant', () => {
    const fn = functionInForce('app', 'pack_choices');
    assert.match(fn, /mi\.slug = any\(pack\.pack_choice_slugs\)/,
      'unrelated permanent items must never become pack choices');
    assert.match(fn, /mi\.brand_id = pack\.brand_id/,
      'a malformed cross-tenant menu row must fail closed');
    assert.match(fn, /d\.brand_id = pack\.brand_id/,
      'a drop from another tenant must not make a choice orderable');
  });
});

describe('atomic order commit', () => {
  it('makes deep health fail closed on missing commit or realtime contracts', () => {
    const readiness = functionInForce('public', 'platform_release_readiness');
    assert.match(readiness, /security invoker/);
    assert.match(readiness, /procedure\.proname = 'commit_order'/);
    assert.match(readiness, /procedure\.pronargs = 18/);
    assert.match(readiness, /tablename = 'orders'/);
    assert.match(readiness, /tablename = 'board_change_signals'/);
    assert.match(readiness, /procedure\.proname = 'publish_manual_training_release'/);
    assert.match(readiness, /operation_occurrences/);
    assert.match(readiness, /operation_action_receipts/);
    assert.match(readiness, /operation_operator_notifications/);
    assert.match(readiness, /procedure\.proname = 'claim_operation_occurrence'/);
    assert.match(readiness, /procedure\.proname = 'cancel_operation_occurrence'/);
    assert.match(readiness, /platform_onboarding_runs/);
    assert.match(readiness, /platform_credential_requirements/);
    assert.match(readiness, /tablename = 'operations_change_signals'/);
    assert.match(readiness, /return '20260828095000'/);
    assert.match(allSql(),
      /revoke all on function public\.platform_release_readiness\(\)[\s\S]*?to service_role;/);
  });

  it('writes the order and initial events inside one service-role invoker function', () => {
    const commit = functionInForce('public', 'commit_order');
    assert.match(commit, /security invoker/);
    assert.doesNotMatch(commit, /security definer/);
    assert.match(commit, /set search_path = ''/);
    assert.match(commit, /insert into public\.orders/);
    assert.match(commit, /insert into public\.order_events/);
    assert.match(commit,
      /on conflict \(brand_id, client_key\) where client_key is not null do nothing/);
    const sql = allSql();
    assert.match(sql, /revoke all on function public\.commit_order\([\s\S]*?from public, anon, authenticated;/);
    assert.match(sql, /grant execute on function public\.commit_order\([\s\S]*?to service_role;/);
  });

  it('resolves an immutable replay under a tenant-key transaction lock', () => {
    const resolver = functionInForce('public', 'resolve_order_replay');
    assert.match(resolver, /security invoker/);
    assert.match(resolver, /pg_advisory_xact_lock\(hashtextextended\(/,
      'a retry must wait for an in-flight winner before it reads mutable state');
    assert.match(resolver,
      /committed\.totals ->> 'request_fingerprint'[\s\S]*?is distinct from p_request_fingerprint/);
    assert.match(resolver, /created event is missing/,
      'a legacy partial row must never replay as a successful checkout');
    assert.match(resolver, /external settlement event is missing/);
    assert.match(allSql(),
      /revoke all on function public\.resolve_order_replay\(uuid, uuid, text\)[\s\S]*?to service_role;/);
  });

  it('resolves before money and tenant checks and binds the snapshot fingerprint', () => {
    const commit = functionInForce('public', 'commit_order');
    assert.match(commit, /if p_client_key is null then[\s\S]*?idempotency key is required/,
      'a checkout without a key cannot be safely retried');
    assert.match(commit, /p_request_fingerprint !~ '\^\[0-9a-f\]\{64\}\$'/);
    assert.match(commit,
      /public\.resolve_order_replay\([\s\S]*?if replayed is not null then return replayed; end if;[\s\S]*?if p_subtotal_cents/,
      'a committed retry must resolve before current money validation');
    assert.match(commit,
      /p_totals ->> 'request_fingerprint' is distinct from p_request_fingerprint/);
    assert.match(allSql(),
      /uuid, uuid, text, uuid\s*\) from public, anon, authenticated;/,
      'the commit_order revoke signature must include the fingerprint argument');
  });

  it('rejects inconsistent money snapshots and cross-tenant references', () => {
    const fn = functionInForce('public', 'commit_order');
    assert.match(fn, /total must equal subtotal \+ tax \+ tip/);
    for (const relation of ['locations', 'customers', 'devices']) {
      assert.match(fn, new RegExp(`from public\\.${relation}`),
        `commit_order must validate ${relation} inside its privileged boundary`);
    }
    assert.match(fn, /device\.brand_id = p_brand_id/);
    assert.match(fn, /device\.location_id = p_location_id/);
  });

  it('leaves pay at pickup unpaid and limits execution to the service role', () => {
    const fn = functionInForce('public', 'commit_order');
    assert.match(fn, /if committed\.tender_type = 'external' then[\s\S]*?'paid'/);
    assert.doesNotMatch(fn, /committed\.tender_type = 'pay_at_pickup'/,
      'cash is paid only when an operator records collection');
  });

  it('limits staff paid and cancelled events to unpaid pay-at-pickup orders', () => {
    const sql = allSql();
    assert.match(sql,
      /order_events\.type in \('paid', 'cancelled'\)[\s\S]*?target\.tender_type = 'pay_at_pickup'/,
      'operator RLS must reject card and external money-state events');
    const transition = functionInForce('app', 'apply_order_event');
    assert.match(transition, /security definer/);
    assert.match(transition, /set search_path = ''/);
    assert.match(transition,
      /new\.source = 'operator'[\s\S]*?new\.square_refund_id is null[\s\S]*?new\.type in \('paid', 'cancelled'\)[\s\S]*?current_tender <> 'pay_at_pickup' or current_status <> 'created'/,
      'the locked pre-transition row must be unpaid pay at pickup');
    assert.match(transition, /from public\.orders target[\s\S]*?for update/,
      'concurrent operator money events must serialize on the order');
    assert.match(sql, /revoke all on function app\.apply_order_event\(\)[\s\S]*?service_role;/);
    for (const column of ['square_refund_id', 'refund_cents', 'refund_request_key']) {
      assert.match(sql, new RegExp(`${column} is null`),
        `operator RLS must reject caller-authored ${column}`);
    }
    assert.match(sql, /not \(snapshot \?\| array\[[\s\S]*?'refund_id'[\s\S]*?'request_key'/,
      'operator RLS must reject general JSON shaped like a refund');
  });

  it('canonicalizes trusted refunds into typed, unique accounting fields', () => {
    const sql = allSql();
    assert.match(sql, /add column refund_cents bigint/);
    assert.match(sql, /add column refund_request_key uuid/);
    assert.match(sql,
      /unique index order_events_refund_request_idx[\s\S]*?\(brand_id, refund_request_key\)[\s\S]*?where refund_request_key is not null/);
    assert.match(sql, /source = 'operator' and refund_request_key is not null/,
      'manual refund rows must always carry an attended request key');
    assert.match(sql,
      /snapshot ->> 'request_key' = refund_request_key::text[\s\S]*?snapshot -> 'requested_amount' = to_jsonb\(refund_cents\)/,
      'the typed key must stay paired with the exact snapshot intent');
    const canonicalizer = functionInForce('app', 'canonicalize_order_refund_event');
    assert.match(canonicalizer, /security invoker/);
    assert.match(canonicalizer, /current_user::text <> 'service_role'/);
    assert.doesNotMatch(canonicalizer, /auth\.role\(\)/);
    assert.match(canonicalizer, /new\.source <> 'webhook'/);
    assert.match(canonicalizer, /new\.refund_cents := refund_cents_text::bigint/);
    assert.match(canonicalizer, /new\.refund_request_key := request_key/);
    assert.match(sql, /create trigger order_events_00_refund_canonicalize/,
      'refund trust checks must run before the privileged state-transition trigger');
  });

  it('lets only the service role claim an exact webhook-first refund winner', () => {
    const claim = functionInForce('public', 'claim_refund_request');
    assert.match(claim, /security invoker/);
    assert.match(claim, /where event\.square_refund_id = p_square_refund_id[\s\S]*?for update/);
    for (const field of ['brand_id', 'order_id', 'refund_cents']) {
      assert.match(claim, new RegExp(`claimed\\.${field} is distinct from p_${field}`),
        `claim must validate ${field}`);
    }
    assert.match(claim, /claimed\.source <> 'webhook'/);
    assert.match(claim,
      /snapshot = event\.snapshot \|\| jsonb_build_object\([\s\S]*?'request_key'[\s\S]*?'requested_amount'/);
    assert.match(claim, /exception when unique_violation then[\s\S]*?errcode = '22023'/);
    const sql = allSql();
    assert.match(sql, /revoke update on public\.order_events from public, anon, authenticated;/);
    assert.match(sql,
      /revoke all on function public\.claim_refund_request\(uuid, uuid, text, bigint, uuid, jsonb\)[\s\S]*?to service_role;/);
  });

  it('uses typed refunds for webhook totals and atomic loyalty reversal', () => {
    const webhook = functionInForce('public', 'process_square_refund');
    assert.match(webhook, /security invoker/);
    assert.match(webhook, /sum\(event\.refund_cents\)/,
      'webhooks must count attended and webhook refunds through one typed ledger');
    assert.doesNotMatch(webhook, /snapshot ->> 'refunded_cents'/);
    assert.doesNotMatch(webhook, /public\.loyalty_reverse_earn/,
      'the one AFTER trigger owns loyalty reversal');

    const sideEffects = functionInForce('app', 'apply_order_event_side_effects');
    assert.match(sideEffects, /security definer/);
    assert.match(sideEffects, /set search_path = ''/);
    assert.match(sideEffects, /public\.loyalty_record_earn/);
    assert.match(sideEffects, /public\.loyalty_reverse_earn/);
    assert.match(sideEffects, /new\.refund_cents/);
    assert.match(sideEffects, /'square_refund:' \|\| new\.square_refund_id/,
      'manual and webhook refund replays must share one reversal cause');
    assert.doesNotMatch(sideEffects, /new\.snapshot/,
      'loyalty must not trust caller-authored general event JSON');
    assert.match(sideEffects, /candidate\.brand_id = new\.brand_id/);
    assert.match(allSql(),
      /revoke all on function app\.apply_order_event_side_effects\(\)[\s\S]*?service_role;/,
      'trigger execution does not require a callable definer helper');
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
  function publicationTables(): string[] {
    const sql = allSql();
    const tables = new Set<string>();
    for (const match of sql.matchAll(
      /alter publication supabase_realtime\s+(add|drop) table public\.([a-z_]+)/gi,
    )) {
      const table = match[2];
      if (!table) continue;
      if (match[1]?.toLowerCase() === 'add') tables.add(table);
      else tables.delete(table);
    }
    return [...tables].sort();
  }

  function subscriberCounts(): Record<string, number> {
    const data = join(MIGRATIONS, '..', '..', 'packages', 'data', 'src');
    const source = readdirSync(data)
      .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'))
      .map((name) => readFileSync(join(data, name), 'utf8'))
      .join('\n');
    const counts: Record<string, number> = {};
    for (const match of source.matchAll(
      /['"]postgres_changes['"]\s*,\s*\{[\s\S]*?table:\s*['"]([a-z_]+)['"]/g,
    )) {
      const table = match[1];
      if (table) counts[table] = (counts[table] ?? 0) + 1;
    }
    return counts;
  }

  it('has the exact subscriber set for every table still in the publication', () => {
    const counts = subscriberCounts();
    assert.deepEqual(publicationTables(), [
      'board_change_signals',
      'brand_config_signals',
      'catalog_publications',
      'drops',
      'location_setting_signals',
      'menu_categories',
      'menu_items',
      'operations_change_signals',
      'orders',
      'prep_batches',
      'training_release_events',
    ]);
    assert.deepEqual(counts, {
      orders: 2,
      board_change_signals: 1,
      brand_config_signals: 1,
      catalog_publications: 2,
      location_setting_signals: 1,
      operations_change_signals: 1,
      menu_items: 1,
      menu_categories: 1,
      drops: 1,
      prep_batches: 1,
      training_release_events: 1,
    });
  });
});

describe('the crew roster', () => {
  it('stores a staff-facing display name instead of rendering auth UUIDs', () => {
    assert.match(allSql(), /alter table public\.brand_users\s+add column display_name text not null default ''/);
    assert.match(typesSource(), /display_name: string/);
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
