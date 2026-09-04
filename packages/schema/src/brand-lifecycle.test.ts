import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

/**
 * Assertions over the suspension migration's text.
 *
 * Deliberately NOT asserted here: that this migration is the newest, or that
 * REQUIRED_DATABASE_RELEASE equals its stamp. surfaces.test.ts and
 * deep-health.test.ts derive both dynamically from the migrations directory;
 * restating them under a feature name breaks that feature's suite on an
 * unrelated change, which has already happened three times in this chain.
 */
const migrationsDir = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../supabase/migrations',
);
const migrationFile = readdirSync(migrationsDir)
  .find((name) => /^\d{14}_brand_lifecycle_suspension\.sql$/.test(name));
assert.ok(migrationFile, 'the brand lifecycle suspension migration exists');
const migration = readFileSync(join(migrationsDir, migrationFile), 'utf8');

/** The migration text with `--` commentary removed. */
const statements = migration.replace(/--[^\n]*/g, '');

const claimHelpers = [
  { name: 'is_brand_staff', args: 'target_brand uuid' },
  { name: 'is_brand_owner', args: 'target_brand uuid' },
  { name: 'at_location', args: 'target_brand uuid, target_location uuid' },
] as const;

describe('brands.status', () => {
  it('adds a not-null lifecycle column with a named three-state check', () => {
    assert.match(statements, /alter table public\.brands\s+add column status text not null default 'active'/);
    assert.match(statements, /constraint brands_status_is_known\s+check \(status in \('active', 'suspended', 'offboarded'\)\)/);
  });

  it('never backfills or rewrites the column, so the ALTER stays catalog-only', () => {
    assert.doesNotMatch(statements, /update public\.brands\s+set status/,
      'a backfill would rewrite every brand row; the default already makes them active');
  });
});

describe('the status read', () => {
  it('is a security definer with an empty search path, which is what avoids the recursion', () => {
    // brands_select (20260722000019) is `is_platform_admin() or
    // is_brand_staff(id)`, so a security invoker read of public.brands from
    // inside is_brand_staff recurses through its own policy -- and because the
    // cycle crosses a function boundary, PostgreSQL's 42P17 policy-recursion
    // detector never fires; the backend dies of stack exhaustion instead.
    assert.match(
      statements,
      /create or replace function app\.brand_is_active\(target_brand uuid\) returns boolean\s+language sql\s+stable\s+security definer\s+set search_path = ''/,
    );
    assert.match(statements, /select 1 from public\.brands brand\s+where brand\.id = target_brand and brand\.status = 'active'/);
  });

  it('stays world-executable, so an anonymous policy evaluation denies instead of raising 42501', () => {
    assert.doesNotMatch(statements, /revoke [^;]*on function app\.brand_is_active/,
      'a policy expression runs with the querying role\'s function privileges');
  });

  it('answers false rather than null for an unknown brand', () => {
    assert.match(statements, /create or replace function app\.brand_is_active\([\s\S]{0,200}?select exists \(/);
  });
});

describe('the claim helpers', () => {
  it('gates all three on brand status', () => {
    for (const helper of claimHelpers) {
      assert.match(
        statements,
        new RegExp(`create or replace function app\\.${helper.name}\\([\\s\\S]+?app\\.brand_is_active\\(target_brand\\)`),
        `${helper.name} does not consult brand status`,
      );
    }
  });

  it('keeps every signature, parameter name and return type identical, so no drop is needed', () => {
    // create or replace cannot change any of these: PostgreSQL raises 42P13 at
    // apply time, which is after everything a pull request runs.
    // function-replacement.test.ts is the cross-migration check; this is the
    // local one, and it also pins that no drop happened -- a drop would discard
    // the ACL and restore default PUBLIC EXECUTE.
    for (const helper of claimHelpers) {
      assert.match(
        statements,
        new RegExp(`create or replace function app\\.${helper.name}\\(${helper.args.replace(/ /g, '\\s+')}\\) returns boolean`),
        `${helper.name} changed its signature under create or replace`,
      );
      assert.doesNotMatch(statements, new RegExp(`drop function[^;]*app\\.${helper.name}`),
        `${helper.name} is dropped, which discards its ACL`);
    }
  });

  it('restates the empty search_path that create or replace would otherwise strip', () => {
    // None of the three carries this clause in its own DDL history: 20260824072313
    // swept `alter function ... set search_path = ''` across schema app. CREATE OR
    // REPLACE replaces SET clauses too, so omitting it here silently unpins the
    // three most security-critical functions in the schema -- and the existing
    // guard (20260830002000) only covers jwt_brand_id and jwt_location_ids.
    for (const helper of claimHelpers) {
      assert.match(
        statements,
        new RegExp(`create or replace function app\\.${helper.name}\\([^)]*\\) returns boolean\\s+language sql stable set search_path = ''`),
        `${helper.name} is replaced without restating its pinned search_path`,
      );
    }
  });

  it('tests is_platform_admin before brand status in every helper that names both', () => {
    for (const helper of ['is_brand_staff', 'is_brand_owner'] as const) {
      const body = new RegExp(`create or replace function app\\.${helper}\\([\\s\\S]+?\\$\\$([\\s\\S]+?)\\$\\$`)
        .exec(statements)?.[1] ?? '';
      const admin = body.indexOf('is_platform_admin');
      const status = body.indexOf('brand_is_active');
      assert.ok(admin > -1, `${helper} no longer admits a platform admin`);
      assert.ok(status > -1, `${helper} no longer reads brand status`);
      assert.ok(admin < status,
        `${helper} checks status before is_platform_admin, so a platform admin `
        + 'loses the brand they just suspended');
    }
  });

  it('keeps the status conjunct out of the platform-admin disjunct', () => {
    const body = /create or replace function app\.is_brand_staff\([\s\S]+?\$\$([\s\S]+?)\$\$/
      .exec(statements)?.[1] ?? '';
    assert.match(body, /app\.is_platform_admin\(\)\s+or \(/,
      'the admin disjunct must stand alone, unconditioned by status');
  });
});

describe('the lifecycle writers', () => {
  const writers = [
    { name: 'suspend_brand', signature: 'p_brand_id uuid, p_reason text', acl: 'uuid, text' },
    { name: 'restore_brand', signature: 'p_brand_id uuid', acl: 'uuid' },
  ] as const;

  it('resolves the actor from auth.uid() and never takes one as an argument', () => {
    // 20260904000000 makes this a release-gated invariant: a writer that takes
    // p_actor_id authorizes against an identity its caller chooses, so it may
    // not be granted to a client role. These are granted to authenticated.
    for (const writer of writers) {
      assert.match(statements,
        new RegExp(`create or replace function public\\.${writer.name}\\(${writer.signature}\\)`),
        `${writer.name} does not have the documented two-part signature`);
      assert.match(statements,
        new RegExp(`create or replace function public\\.${writer.name}\\([\\s\\S]+?actor_id uuid := \\(select auth\\.uid\\(\\)\\);`),
        `${writer.name} does not resolve its actor from auth.uid()`);
      assert.doesNotMatch(statements,
        new RegExp(`create or replace function public\\.${writer.name}\\([^)]*p_actor_id`),
        `${writer.name} takes an actor id as an argument`);
    }
  });

  it('runs security definer with an empty search path, reachable by authenticated and not anon', () => {
    for (const writer of writers) {
      assert.match(statements,
        new RegExp(`create or replace function public\\.${writer.name}\\([\\s\\S]+?security definer\\s+set search_path = ''`));
      const revoke = statements.indexOf(`revoke all on function public.${writer.name}(${writer.acl}) from public, anon;`);
      const grant = statements.indexOf(`grant execute on function public.${writer.name}(${writer.acl}) to authenticated;`);
      assert.ok(revoke > -1, `${writer.name} does not revoke public and anon`);
      assert.ok(revoke < grant, `${writer.name} grants before it revokes, so the grant is discarded`);
      assert.doesNotMatch(statements,
        new RegExp(`grant execute on function public\\.${writer.name}\\(${writer.acl}\\) to [^;]*anon`),
        `${writer.name} is reachable by anon`);
    }
  });

  it('requires a platform_admin membership and a stated reason', () => {
    const suspend = /create or replace function public\.suspend_brand\([\s\S]+?\$\$([\s\S]+?)\$\$/
      .exec(statements)?.[1] ?? '';
    assert.match(suspend, /member\.role = 'platform_admin'/);
    assert.match(suspend, /errcode = '42501', message = 'platform_actor_required'/);
    assert.match(suspend, /message = 'invalid_suspension_reason'/,
      'a suspension with no stated reason cannot be defended later');
  });

  it('suspends, revokes every device and every delegated grant, and audits, in one function', () => {
    const suspend = /create or replace function public\.suspend_brand\([\s\S]+?\$\$([\s\S]+?)\$\$/
      .exec(statements)?.[1] ?? '';
    assert.match(suspend, /update public\.brands brand set status = 'suspended'/);
    // Reused rather than inlined: it also ends live stream sessions and writes
    // their audit rows, which a bare revoked_at stamp would skip.
    assert.match(suspend, /perform app\.revoke_device_installation\(installation\.id, p_brand_id\)/);
    assert.match(suspend, /from public\.device_installations target\s+where target\.brand_id = p_brand_id and target\.revoked_at is null/);
    assert.match(suspend, /update public\.delegated_access_grants grant_row\s+set revoked_at = pg_catalog\.now\(\)/);
    assert.match(suspend, /insert into public\.platform_access_events \([\s\S]+?'brands\.suspend'/);
  });

  it('is idempotent without writing a second audit row, and treats offboarded as terminal', () => {
    for (const writer of ['suspend_brand', 'restore_brand'] as const) {
      const body = new RegExp(`create or replace function public\\.${writer}\\([\\s\\S]+?\\$\\$([\\s\\S]+?)\\$\\$`)
        .exec(statements)?.[1] ?? '';
      assert.match(body, /for update;/, `${writer} does not lock the brand row`);
      assert.match(body, /message = 'brand_already_offboarded'/);
      assert.match(body, /return false;/, `${writer} is not idempotent`);
      assert.match(body, /message = 'platform_brand_not_found'/);
    }
    const restore = /create or replace function public\.restore_brand\([\s\S]+?\$\$([\s\S]+?)\$\$/
      .exec(statements)?.[1] ?? '';
    assert.match(restore, /'brands\.restore'/);
    // Revocation is a historical fact; restore lifts authorization only.
    assert.doesNotMatch(restore, /revoked_at = null/);
    assert.doesNotMatch(restore, /device_installations/);
  });

  it('deletes nothing -- no membership, no history', () => {
    assert.doesNotMatch(statements, /delete from public\./,
      'suspension preserves the evidence a contested separation turns on');
    assert.doesNotMatch(statements, /update public\.brand_users/);
  });
});

describe('the release assertion', () => {
  it('registers itself with a zero-argument assertion locked to the service role', () => {
    const stamp = migrationFile.split('_')[0];
    assert.match(statements,
      /create or replace function app\.assert_brand_lifecycle_suspension\(\)\s+returns void language plpgsql stable security invoker set search_path = ''/);
    assert.match(statements,
      /revoke all on function app\.assert_brand_lifecycle_suspension\(\)\s+from public, anon, authenticated;/);
    assert.match(statements,
      /grant execute on function app\.assert_brand_lifecycle_suspension\(\) to service_role;/);
    assert.match(statements, new RegExp(
      `select app\\.register_release\\(\\s*'${stamp}',[\\s\\S]+?'app\\.assert_brand_lifecycle_suspension\\(\\)'::regprocedure\\s*\\);`));
  });

  it('asserts the column, the check, the short-circuit and the writer reachability', () => {
    const assertion = /create or replace function app\.assert_brand_lifecycle_suspension\(\)[\s\S]+?\$\$([\s\S]+?)\$\$/
      .exec(statements)?.[1] ?? '';
    assert.match(assertion, /attname = 'status'\s+and attribute\.attnotnull/);
    assert.match(assertion, /conname = 'brands_status_is_known'/);
    assert.match(assertion, /admin_at > status_at/,
      'the short-circuit ordering is what keeps a platform admin able to restore');
    assert.match(assertion, /has_function_privilege\('anon', 'public\.suspend_brand\(uuid, text\)', 'execute'\)/);
    assert.match(assertion, /has_function_privilege\('anon', 'app\.brand_is_active\(uuid\)', 'execute'\)/);
  });

  it('reads the search_path value instead of matching the serialized entry', () => {
    // PostgreSQL stores `set search_path = ''` with the empty identifier
    // QUOTED, so a predicate matching an unquoted entry is never true.
    // 20260903210000 shipped exactly that and, because these assertions raise
    // on violation and platform_release_readiness() runs all of them, it took
    // the release gate red. This gate must not inherit the bug, and must not
    // reintroduce the literal that the definer-search-path guard greps for.
    const assertion = /create or replace function app\.assert_brand_lifecycle_suspension\(\)[\s\S]+?\$\$([\s\S]+?)\$\$/
      .exec(statements)?.[1] ?? '';
    assert.match(assertion, /split_part\(entry, '=', 1\) = 'search_path'/,
      'the assertion must key on the setting name');
    assert.match(assertion, /btrim\(pg_catalog\.split_part\(entry, '=', 2\), '"'\) = ''/,
      'the assertion must require the value to be empty, under either quoting');
    assert.doesNotMatch(assertion, /@> array\[/,
      'containment against a serialized proconfig entry is the bug this avoids');
  });

  it('covers every function it creates or replaces in the search_path loop', () => {
    const pinned = /pinned constant text\[\] := array\[([\s\S]+?)\];/.exec(statements)?.[1] ?? '';
    for (const signature of [
      'app.brand_is_active(uuid)',
      'app.is_brand_staff(uuid)',
      'app.is_brand_owner(uuid)',
      'app.at_location(uuid, uuid)',
      'public.suspend_brand(uuid, text)',
      'public.restore_brand(uuid)',
    ]) {
      assert.ok(pinned.includes(`'${signature}'`), `${signature} is not in the pinned list`);
    }
    // A renamed function must fail the gate rather than quietly leave it green.
    assert.match(statements, /is missing; this assertion no longer covers it/);
  });

  it('keeps the claim helpers security invoker and the definers definer', () => {
    const assertion = /create or replace function app\.assert_brand_lifecycle_suspension\(\)[\s\S]+?\$\$([\s\S]+?)\$\$/
      .exec(statements)?.[1] ?? '';
    assert.match(assertion, /and not proc\.prosecdef/,
      'the status read and both writers must stay security definer');
    assert.match(assertion, /and proc\.prosecdef\s*\)\s*then raise exception 'a claim helper became security definer/,
      'a definer claim helper would read the wrong role\'s claims');
  });

  it('pins the premise that public.brands is not FORCE ROW LEVEL SECURITY', () => {
    // The owner-exemption is what stops the definer status read from being
    // filtered by brands_select. Forcing RLS looks like hardening and turns
    // every staff read on the platform into 42P17.
    const assertion = /create or replace function app\.assert_brand_lifecycle_suspension\(\)[\s\S]+?\$\$([\s\S]+?)\$\$/
      .exec(statements)?.[1] ?? '';
    assert.match(assertion, /oid = 'public\.brands'::regclass and relforcerowsecurity/);
  });
});
