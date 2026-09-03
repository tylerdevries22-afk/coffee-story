import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const migrationsDir = join(root, 'supabase/migrations');
const migrationNames = readdirSync(migrationsDir).filter((n) => n.endsWith('.sql')).sort();
const migrationFile = migrationNames
  .find((name) => /^\d{14}_scope_anon_catalog_and_signal_reads\.sql$/.test(name));
assert.ok(migrationFile, 'the anon read scoping migration exists');
const migration = readFileSync(join(migrationsDir, migrationFile), 'utf8');
const allSql = migrationNames
  .map((name) => readFileSync(join(migrationsDir, name), 'utf8')).join('\n');

/**
 * The boundary this release turns on, checked where a database is not.
 *
 * `pnpm verify` runs no Postgres and the hosted integration job is skipped on
 * pull requests, so these assertions are the only thing standing between a
 * reopened anon grant and a merge. They are deliberately stated over the
 * migration text rather than a live catalog for that reason.
 */
describe('the anonymous read is scoped to the row a client already names', () => {
  it('takes the whole catalog_releases grant back from anon', () => {
    assert.match(migration, /^revoke select on public\.catalog_releases from anon;$/m,
      'the manifest of every brand must stop being an anon table read');
    assert.doesNotMatch(migration,
      /grant select[^;]*on public\.catalog_releases to[^;]*anon/,
      'nothing in this migration may hand any part of it back');
  });

  it('replaces it with a lookup that takes the brand as an argument', () => {
    assert.match(migration,
      /create or replace function app\.published_catalog_rows\(p_brand_id uuid\)/,
      'the brand is the only thing a caller names');
    assert.match(migration,
      /create or replace function app\.published_catalog_rows[\s\S]+?security definer\s+set search_path = ''/,
      'the definer must be pinned to an empty search_path');
    assert.match(migration, /where p_brand_id is not null/,
      'naming no brand must return nothing rather than everything');
    assert.match(migration, /and release\.status = 'published'/,
      'a draft or retired release is not storefront data');
    const definer = /create or replace function app\.published_catalog_rows[\s\S]+?\$\$;/
      .exec(migration);
    assert.ok(definer, 'the definer is not defined');
    assert.doesNotMatch(definer[0], /created_by/,
      'created_by is a brand_users id and must stay out of the guest projection');
    assert.match(migration,
      /grant execute on function public\.published_catalog_lookup\(uuid\)\s+to anon, authenticated, service_role;/,
      'the guest menu has to be able to call it');
  });

  it('keeps the realtime signal reads alive one column wide', () => {
    for (const [relation, keeps] of [
      ['catalog_publications', 'brand_id'],
      ['brand_config_signals', 'brand_id'],
      ['location_setting_signals', 'location_id'],
    ] as const) {
      const revoke = migration.indexOf(`revoke select on public.${relation} from anon;`);
      const grant = migration.indexOf(`grant select (${keeps}) on public.${relation} to anon;`);
      assert.ok(revoke > -1, `${relation} must lose its table-wide anon grant`);
      assert.ok(grant > revoke,
        `${relation} must regain exactly ${keeps}, and only after the revoke`);
    }
  });

  it('leaves the column the subscription filter names, not an arbitrary one', () => {
    // Realtime refuses a subscription filtering on a column the role cannot
    // read, and checks visibility by primary key. These are the columns
    // packages/data actually filters on; a narrower grant is an outage.
    const data = join(root, 'packages/data/src');
    const source = readdirSync(data)
      .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'))
      .map((name) => readFileSync(join(data, name), 'utf8')).join('\n');
    for (const [relation, keeps] of [
      ['catalog_publications', 'brand_id'],
      ['brand_config_signals', 'brand_id'],
      ['location_setting_signals', 'location_id'],
    ] as const) {
      const pattern = new RegExp(
        `table: '${relation}', filter: \`${keeps}=eq\\.\\$\\{[a-zA-Z]+\\}\``,
      );
      assert.match(source, pattern,
        `a client subscribes to ${relation} filtering on ${keeps}; the grant must keep it`);
    }
  });

  it('registers an assertion that fails both ways', () => {
    assert.match(migration,
      /create or replace function app\.assert_anon_reads_are_scoped\(\)\s+returns void language plpgsql stable security invoker set search_path = ''/,
      'the assertion takes no arguments and is pinned');
    assert.match(migration, /raise exception 'anon can read public\.catalog_releases again'/,
      'a re-granted table read must fail the release');
    assert.match(migration, /realtime filters on it, so every deployed client goes quiet/,
      'and so must a revoke that silently kills live config updates');
    assert.match(migration,
      /select app\.register_release\(\s*'20260903230000',[\s\S]*?'app\.assert_anon_reads_are_scoped\(\)'::regprocedure\s*\);/,
      'the migration registers its own release with its own assertion');
  });

  /**
   * Deliberately not "this migration is the newest" or "deep health requires
   * this stamp". Both were true the day this was written and false the moment
   * anything landed after it, and that mistake has now been made three times
   * in this migration chain -- each time failing a test that names one feature
   * on a change that has nothing to do with it. Whether the newest migration
   * registers itself, and whether REQUIRED_DATABASE_RELEASE equals it, are
   * properties of whichever migration currently sorts last: surfaces.test.ts
   * derives that dynamically and deep-health.test.ts pins it. What is this
   * migration's own business is that it registers its own stamp, which the
   * assertion above already checks.
   */
  it('registers the stamp in its own filename', () => {
    const stamp = migrationFile.slice(0, 14);
    assert.match(migration, new RegExp(`select app\\.register_release\\(\\s*'${stamp}',`),
      'the registered stamp matches the filename');
  });

  it('says nothing about kiosk_receipts, which 0042 dropped', () => {
    // The 0034 grant is still in the history and reads like a live anon
    // surface. It is not: the view is gone, and a grant on a dropped view is
    // not a hole to close.
    const drop = allSql.lastIndexOf('drop view if exists public.kiosk_receipts;');
    const grant = allSql.lastIndexOf('grant select on public.kiosk_receipts');
    assert.ok(drop > grant, 'the last word on kiosk_receipts must be the drop');
  });
});
