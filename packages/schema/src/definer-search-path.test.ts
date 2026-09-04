import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

/**
 * An assertion about `search_path` has to match how PostgreSQL stores it.
 *
 * `set search_path = ''` is recorded in `pg_proc.proconfig` as the *quoted*
 * empty string -- `search_path=""` -- whether it was written in
 * `create function` or in a later `alter function`. Verified on PostgreSQL
 * 17.10; the bare `search_path=` spelling is not a serialization PostgreSQL
 * ever produces.
 *
 * So a readiness assertion testing `proconfig @> array['search_path=']` is
 * false for every function that *has* the setting. Negated -- as these
 * assertions always are, since they raise on violation -- it raises
 * unconditionally, and because the readiness head runs every registered
 * assertion, one such comparison takes the whole release gate down.
 *
 * That is not hypothetical. `20260903210000` shipped it, `main` could not
 * reach a green release gate until `20260904005000` replaced the function, and
 * neither `pnpm verify` nor review caught it: the string looks like the SQL
 * that produced it, and no job in `verify` has a database. A grep does catch
 * it, so this is a grep.
 */
const MIGRATIONS = join(dirname(fileURLToPath(import.meta.url)), '../../../supabase/migrations');

/**
 * A quoted literal that is exactly `search_path=` with no value.
 *
 * The closing quote is a backreference so the correct form -- `'search_path=""'`,
 * which two migrations were already using -- does not match, and neither does
 * the `'search_path=%'` of a LIKE pattern.
 */
const UNQUOTED_EMPTY = /(['"])search_path=\1/;

/**
 * Executable SQL only.
 *
 * The migration that fixed this bug quotes the broken form in its own header
 * to explain it, and so does this file's ledger reason -- a comment cannot
 * raise, so matching one would make the guard unable to describe itself.
 */
function withoutComments(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n')
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n');
}

/**
 * The one migration that shipped the broken comparison.
 *
 * The chain is forward-only, so it stays exactly as it was written; the fix is
 * a later `create or replace`, not an edit here. Grandfathering it names the
 * instance and points at its replacement, which is what a reader who greps and
 * finds a hit needs to know. Nothing may be added to this list -- a new hit is
 * a new outage.
 */
const SUPERSEDED: Readonly<Record<string, string>> = {
  '20260903210000_close_anon_disclosure_and_repin_definers.sql':
    'superseded by 20260904005000, which replaces the function with a value-based check',
};

const files = readdirSync(MIGRATIONS)
  .filter((name) => name.endsWith('.sql'))
  .map((name) => ({ name, sql: readFileSync(join(MIGRATIONS, name), 'utf8') }));

describe('search_path assertions match the catalog', () => {
  it('reads the migration chain, so the guard cannot pass by finding nothing', () => {
    assert.ok(files.length > 100, `found only ${files.length} migrations`);
  });

  it('never compares proconfig against an unquoted empty search_path', () => {
    const offenders = files
      .filter(({ sql }) => UNQUOTED_EMPTY.test(withoutComments(sql)))
      .map(({ name }) => name)
      .filter((name) => !(name in SUPERSEDED))
      .sort();
    assert.deepEqual(offenders, [],
      'these migrations test for `search_path=` with no value. PostgreSQL stores '
      + 'an empty search_path as `search_path=""`, so the comparison is always '
      + 'false and a negated assertion raises unconditionally -- taking the whole '
      + 'release gate down. Compare against \'search_path=""\', or split the entry '
      + 'on `=` and check that the value is empty.');
  });

  it('keeps the superseded ledger honest', () => {
    for (const name of Object.keys(SUPERSEDED)) {
      const entry = files.find((file) => file.name === name);
      assert.ok(entry, `${name} is no longer in the chain; drop its ledger entry`);
      assert.ok(UNQUOTED_EMPTY.test(withoutComments(entry.sql)),
        `${name} no longer carries the broken comparison; drop its ledger entry`);
    }
    // The replacement has to still be there, or the ledger is excusing a live bug.
    assert.ok(files.some(({ name }) => name.startsWith('20260904005000')),
      'the migration that replaces the broken assertion is gone from the chain');
  });

  /**
   * The positive half: the two functions the disclosure assertion covers mint
   * claims and fire on brand-config writes, so an empty search_path on both is
   * the property being protected. If a later migration repins either,
   * `20260904005000`'s assertion catches it at release time -- but only while
   * the migration that pins them is still in the chain, which is this check.
   *
   * Matched per file rather than over the concatenated chain, so a failure
   * names the migration instead of printing every migration.
   */
  it('still pins the claims hook and the brand-config signal to an empty search_path', () => {
    for (const fn of ['custom_access_token', 'signal_brand_config_change']) {
      const pinned = new RegExp(`\\b${fn}\\s*\\([^)]*\\)[\\s\\S]{0,400}?search_path = ''`);
      const where = files.filter(({ sql }) => pinned.test(sql)).map(({ name }) => name);
      assert.ok(where.length > 0,
        `app.${fn} is never pinned to an empty search_path in the migration chain, `
        + 'so the readiness assertion that guards it is guarding nothing');
    }
  });
});
