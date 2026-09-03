import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const migrationsDir = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../supabase/migrations',
);
const migrationNames = readdirSync(migrationsDir).sort();
const migrationFile = migrationNames
  .find((name) => /^\d{14}_franchisor_network_reporting\.sql$/.test(name));
assert.ok(migrationFile, 'the franchisor network reporting migration exists');
const migration = readFileSync(join(migrationsDir, migrationFile), 'utf8');

/**
 * The boundary this release turns on, checked where a database is not.
 *
 * The integration suite proves the refusals against a real stack, but it skips
 * whenever one is not configured -- which is most of the time a contributor
 * runs `pnpm verify`. These assertions are the half that always runs: the
 * grant that must exist, and the grant that must never.
 */
describe('franchisor network reporting boundary', () => {
  it('resolves the subject from the session rather than an argument', () => {
    assert.match(migration,
      /create or replace function public\.caller_network_brand_kpis\(p_network_id uuid\)/,
      'the network is the only thing a caller names');
    assert.match(migration,
      /create or replace function public\.caller_network_brand_kpis\([\s\S]+?security definer\s+set search_path = ''/);
    // Wrapped for the auth_rls_initplan advisor that 20260902144208 exists to
    // satisfy; `pnpm supabase:verify` runs --fail-on warn.
    assert.match(migration, /caller := \(select auth\.uid\(\)\);/);
    assert.match(migration,
      /if caller is null then\s+raise exception using errcode = 'P0002'/,
      'a session with no subject is refused rather than defaulted');
  });

  it('checks revocation and expiry on both the guard and the projection', () => {
    const guards = migration.match(/grant_row\.revoked_at is null/g) ?? [];
    assert.equal(guards.length, 2,
      'the authorization check and the per-brand filter each test revocation');
    const expiries = migration.match(/grant_row\.expires_at > pg_catalog\.now\(\)/g) ?? [];
    assert.equal(expiries.length, 2, 'and each tests expiry');
    const scopes = migration.match(/'network:kpis' = any \(grant_row\.scope\)/g) ?? [];
    assert.equal(scopes.length, 2, 'and each tests scope');
  });

  it('opens the caller-identity form to authenticated sessions', () => {
    const revoke = migration.indexOf(
      'revoke all on function public.caller_network_brand_kpis(uuid)\n  from public, anon, authenticated;');
    const open = migration.indexOf(
      'grant execute on function public.caller_network_brand_kpis(uuid) to authenticated;');
    assert.ok(revoke > -1, 'broad privileges are revoked first');
    assert.ok(revoke < open, 'and the narrow grant follows the revoke');
    assert.doesNotMatch(migration,
      /grant execute on function public\.caller_network_brand_kpis\(uuid\) to anon/,
      'a logged-out reader has no network to report on');
  });

  /**
   * The invariant the whole design rests on. app.network_brand_kpis takes the
   * user it authorizes as its second argument and is security definer, so a
   * client role holding EXECUTE on it could read any network by naming that
   * network's franchisor. No migration may ever hand it to one.
   */
  it('never grants the argument-identity form to a client role', () => {
    for (const name of migrationNames.filter((file) => file.endsWith('.sql'))) {
      const sql = readFileSync(join(migrationsDir, name), 'utf8');
      assert.doesNotMatch(sql,
        /grant execute on function app\.network_brand_kpis\(uuid, ?uuid\)[\s\S]{0,40}?to [^;]*\b(anon|authenticated)\b/,
        `${name} would let a client choose whose network it reads`);
    }
  });

  /**
   * This used to also assert that the migration sorted last. That was true for
   * exactly as long as it was the newest one, and it began failing the moment
   * 20260903220000 landed -- on a change that has nothing to do with franchise
   * reporting. Whether the newest migration registers its own release is a
   * property of whichever migration is newest, so it belongs to the test that
   * derives that dynamically (surfaces.test.ts) and to deep-health.test.ts,
   * which pins REQUIRED_DATABASE_RELEASE to it. What is left here is what is
   * actually this migration's own business: it registers its own stamp, and
   * the assertion it registers is one the frozen head can call.
   */
  it('registers its own stamp with a zero-argument assertion', () => {
    const stamp = migrationFile.slice(0, 14);
    assert.ok(migrationNames.includes(migrationFile),
      'the migration this test describes is still in the tree');
    assert.match(migration, new RegExp(
      `select app\\.register_release\\(\\s*'${stamp}',`),
      'the registered stamp matches the filename');
    assert.match(migration,
      /'app\.assert_franchisor_network_reporting\(\)'::regprocedure/);
    assert.match(migration,
      /create or replace function app\.assert_franchisor_network_reporting\(\)\s+returns void/,
      'the assertion the head will call takes no arguments');
    assert.doesNotMatch(migration, /rename to platform_release_readiness/,
      '20260903020255 froze the rename chain; new claims register a row');
  });
});
