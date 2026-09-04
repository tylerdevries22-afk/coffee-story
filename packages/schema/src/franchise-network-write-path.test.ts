import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const migrationsDir = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../supabase/migrations',
);
const migrationNames = readdirSync(migrationsDir).filter((name) => name.endsWith('.sql')).sort();
const migrationFile = migrationNames
  .find((name) => /^\d{14}_franchise_network_write_path\.sql$/.test(name));
assert.ok(migrationFile, 'the franchise network write path migration exists');
const migration = readFileSync(join(migrationsDir, migrationFile), 'utf8');

/**
 * The four writers the franchise tables never had, checked where a database
 * is not.
 *
 * `pnpm verify` runs no Postgres and the hosted integration job is skipped on
 * pull requests, so these assertions are the only thing between a merge and a
 * writer that authorizes the wrong party. They are stated over the migration
 * text for that reason; the release-gated
 * `app.assert_franchise_network_write_path` states the same boundary against
 * the live catalog once the migration is applied.
 *
 * Deliberately NOT asserted here: that this migration sorts last, or that it
 * matches `REQUIRED_DATABASE_RELEASE`. Both are properties of whichever
 * migration is newest rather than of this one, and pinning them here fails a
 * test named for franchise writes on an unrelated change --
 * `franchisor-network-reporting.test.ts` carries the comment explaining that
 * it already happened. `surfaces.test.ts` and `deep-health.test.ts` own that
 * invariant dynamically.
 */
const WRITERS = [
  { name: 'create_franchise_network', args: '(text, text)' },
  { name: 'enroll_brand_in_network', args: '(uuid, uuid)' },
  { name: 'grant_delegated_access', args: '(uuid, uuid, uuid, text[], timestamptz)' },
  { name: 'revoke_delegated_access', args: '(uuid)' },
] as const;

/** One writer's whole definition, from the CREATE to its closing `end $$;`. */
function definitionOf(name: string): string {
  const match = new RegExp(
    `create or replace function public\\.${name}\\([\\s\\S]*?\\nend \\$\\$;`,
  ).exec(migration);
  assert.ok(match, `public.${name} is not defined in ${migrationFile}`);
  return match[0];
}

describe('the franchise network write path', () => {
  it('defines all four writers, each security definer on an empty search path', () => {
    for (const writer of WRITERS) {
      const definition = definitionOf(writer.name);
      assert.match(definition, /security definer\s+set search_path = ''/,
        `public.${writer.name} must be a definer pinned to an empty search_path`);
      assert.match(definition, /language plpgsql/);
    }
  });

  /**
   * The invariant 20260904000000 turned on, from the other side. These four
   * ARE reachable by a role that chooses its own arguments, so the identity
   * they authorize must never be one of those arguments -- otherwise any
   * signed-in user could pass a platform admin's uuid and write on their
   * behalf, which is exactly what that migration's eight service-only writers
   * are quarantined for.
   */
  it('resolves the actor from the session rather than an argument', () => {
    for (const writer of WRITERS) {
      const definition = definitionOf(writer.name);
      // Wrapped for the auth_rls_initplan advisor `pnpm supabase:verify` fails
      // on, and the shape create_platform_organization established.
      assert.match(definition, /actor_id uuid := \(select auth\.uid\(\)\);/,
        `public.${writer.name} must resolve its own actor`);
      const signature = /create or replace function public\.\w+\(([\s\S]*?)\)\s*\n?returns/
        .exec(definition);
      assert.ok(signature, `cannot read the parameter list of public.${writer.name}`);
      assert.doesNotMatch(signature[1] ?? '', /actor/i,
        `public.${writer.name} takes its actor as an argument and is granted to a client role`);
      assert.match(definition, /raise exception using errcode = '42501'/,
        `public.${writer.name} must refuse an unauthorized caller with 42501`);
    }
  });

  it('revokes the broad privileges before granting the narrow ones, and never to anon', () => {
    for (const writer of WRITERS) {
      const revoke = migration.indexOf(
        `revoke all on function public.${writer.name}${writer.args}\n  from public, anon;`);
      const open = migration.indexOf(
        `grant execute on function public.${writer.name}${writer.args}\n  to authenticated, service_role;`);
      assert.ok(revoke > -1, `public.${writer.name} does not revoke public and anon first`);
      assert.ok(revoke < open, `public.${writer.name} grants before it revokes`);
      assert.doesNotMatch(migration, new RegExp(
        `grant execute on function public\\.${writer.name}[^;]*to[^;]*\\banon\\b`),
        `a logged-out caller has no franchise network to write`);
    }
  });

  /**
   * Tree-wide, not just here. The grant that would matter is the one a later
   * migration adds, and a check confined to this file would never see it.
   */
  it('is never handed to anon by any migration', () => {
    for (const name of migrationNames) {
      const sql = readFileSync(join(migrationsDir, name), 'utf8');
      for (const writer of WRITERS) {
        assert.doesNotMatch(sql, new RegExp(
          `grant execute on function public\\.${writer.name}\\([^)]*\\)[\\s\\S]{0,60}?to [^;]*\\banon\\b`),
          `${name} would let a logged-out caller call public.${writer.name}`);
      }
    }
  });

  it('writes an audit row for every writer, in the same transaction', () => {
    const actions = [...migration.matchAll(
      /insert into public\.platform_access_events \([\s\S]*?'(franchise_network\.[a-z_.]+)'/g,
    )].map(([, action]) => action);
    assert.deepEqual(actions, [
      'franchise_network.create',
      'franchise_network.brand_enroll',
      'franchise_network.delegated_grant',
      'franchise_network.delegated_revoke',
    ], 'each writer appends exactly one platform_access_events row');
    for (const action of actions) {
      // record_platform_access is service-role only and re-checks
      // platform_admin against an argument, so these write the trail directly
      // -- which means matching its action grammar here.
      assert.match(action, /^[a-z][a-z0-9_.]{2,95}$/);
    }
  });

  it('makes enrolment idempotent rather than an error', () => {
    const definition = definitionOf('enroll_brand_in_network');
    assert.match(definition,
      /on conflict \(network_id, brand_id\) do nothing/,
      'a second enrolment must be a no-op, not a 23505');
    assert.match(definition, /enrolled := found;/,
      'the caller is still told which of the two it got');
    assert.match(definition, /app\.is_franchise_network_admin\(p_network_id, actor_id\)/,
      'the network\'s own admins may enrol, since the schema expresses no owner column');
  });

  it('bounds a delegated grant to the network, the scope grammar, and 30 days', () => {
    const definition = definitionOf('grant_delegated_access');
    assert.match(definition, /from public\.franchise_network_brands member_brand/,
      'a grant over a brand outside the network authorizes nothing and must be refused');
    assert.match(definition, /'delegated_brand_outside_network'/);
    assert.match(definition, /app\.valid_delegated_scope\(p_scope\)/);
    assert.match(definition, /p_expires_at > pg_catalog\.now\(\) \+ interval '30 days'/,
      'the table CHECK is restated so the caller learns what it did wrong');
    assert.match(definition, /p_expires_at <= pg_catalog\.now\(\)/,
      'an already-expired grant is not a grant');
    assert.match(definition, /app\.is_brand_owner\(p_brand_id\)/,
      'the brand that lends the access decides');
  });

  /**
   * The function this release exists for. Before it, `revoked_at` was written
   * by one caller -- `public.prune_delegated_access_grants` (20260903153000),
   * which only back-dates grants whose `expires_at` has already passed. There
   * was no early-termination path, so cutting a fired analyst's access meant
   * waiting up to the table's thirty-day ceiling.
   */
  it('ends a grant early, idempotently, for the brand that granted it', () => {
    const definition = definitionOf('revoke_delegated_access');
    assert.match(definition, /set revoked_at = least\(pg_catalog\.now\(\), existing\.expires_at\)/,
      'revoked_at means the moment the grant stopped authorizing, which for an '
      + 'already-expired grant is its expiry rather than now()');
    assert.match(definition, /if target\.revoked_at is not null then\s+return false;/,
      'revoking an ended grant is a no-op, not an error');
    assert.match(definition, /for update;/,
      'two concurrent revocations must serialize rather than race');
    assert.match(definition, /app\.is_brand_owner\(target\.brand_id\)/);
    assert.doesNotMatch(definition, /grantee_user_id = actor_id/,
      'the grantee may not tidy away the row the granting brand is meant to keep');
    assert.match(migration,
      /grant execute on function public\.revoke_delegated_access\(uuid\)\n  to authenticated, service_role;/,
      'a brand owner has to be able to call it from their own session');
  });

  it('registers its own stamp with a zero-argument assertion', () => {
    const stamp = migrationFile.slice(0, 14);
    assert.match(migration, new RegExp(
      `select app\\.register_release\\(\\s*'${stamp}',`),
      'the registered stamp matches the filename');
    assert.match(migration,
      /'app\.assert_franchise_network_write_path\(\)'::regprocedure/);
    assert.match(migration,
      /create or replace function app\.assert_franchise_network_write_path\(\)\s+returns void/,
      'the assertion the frozen head will call takes no arguments');
    assert.doesNotMatch(migration, /rename to platform_release_readiness/,
      '20260903020255 froze the rename chain; new claims register a row');
  });

  it('asserts the boundary against the live catalog too', () => {
    const assertion = /create or replace function app\.assert_franchise_network_write_path\(\)[\s\S]*?\nend \$\$;/
      .exec(migration);
    assert.ok(assertion, 'the readiness assertion is not defined');
    for (const writer of WRITERS) {
      assert.ok(assertion[0].includes(`public.${writer.name}(${writer.args.slice(1, -1).replace(/, /g, ',')})`),
        `the assertion does not name public.${writer.name}`);
    }
    assert.match(assertion[0], /has_function_privilege\('anon', target, 'execute'\)/,
      'a missing signature must fail rather than silently empty the check');
    assert.match(assertion[0], /to_regprocedure\(target\) is null/);
    assert.match(migration,
      /revoke all on function app\.assert_franchise_network_write_path\(\)\n  from public, anon, authenticated;/);
  });
});
