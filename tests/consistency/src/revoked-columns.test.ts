import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

/**
 * A client query must not name a column the schema has taken away from it.
 *
 * Column-level `revoke select (...)` is a good tool with a sharp edge: naming a
 * revoked column does not return a redacted row, it fails the WHOLE query with
 * "permission denied for column". So a revoke in a migration can break a page
 * in an app nobody touched, and neither typecheck nor any unit test sees it --
 * the break only exists against a real database with a real role.
 *
 * That is exactly how `apps/hq/lib/data.ts` broke: 0040 revoked
 * `square_connection_id` from `authenticated`, and `loadLocations` -- which runs
 * under the signed-in user -- still named it. The Locations page would have
 * failed for every brand owner, in a change that never touched HQ.
 *
 * This reads the revokes out of the migrations and checks no app source names
 * one inside a `.select(...)`. It is deliberately textual: the alternative is a
 * live database, and this needs to run in `pnpm test`.
 */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const MIGRATIONS = join(ROOT, 'supabase', 'migrations');

/**
 * Files whose queries always run under the service role, which bypasses these
 * revokes entirely. They take a client as a PARAMETER, so the role cannot be
 * seen from the file itself -- it has to be asserted here, with the caller.
 */
const SERVICE_ROLE_ONLY: Record<string, string> = {
  'apps/hq/lib/square-runtime.ts':
    'takes a SupabaseClient parameter; its only caller is app/api/orders/route.ts, which passes serviceDb(env)',
};

/** `table.column` -> which migration revoked it. */
function revokedColumns(): Map<string, string> {
  const revoked = new Map<string, string>();
  for (const name of readdirSync(MIGRATIONS).filter((file) => file.endsWith('.sql')).sort()) {
    const sql = readFileSync(join(MIGRATIONS, name), 'utf8');
    const pattern = /revoke\s+select\s*\(([^)]+)\)\s*on\s+([\w.]+)\s+from\s+([^;]+);/gi;
    for (const match of sql.matchAll(pattern)) {
      const roles = (match[3] ?? '').toLowerCase();
      // Only client roles matter: the service role bypasses this entirely.
      if (!roles.includes('anon') && !roles.includes('authenticated')) continue;
      const table = (match[2] ?? '').replace(/^public\./, '');
      for (const column of (match[1] ?? '').split(',')) {
        const trimmed = column.trim();
        // Keyed by TABLE and column: `fee_bps` is revoked on locations and not
        // on brands, and flagging a brands read would be a false alarm that
        // teaches people to ignore this test.
        if (trimmed) revoked.set(`${table}.${trimmed}`, `${name} (on ${match[2]})`);
      }
    }
  }
  return revoked;
}

/** Every .ts/.tsx under apps/, excluding build output and tests. */
function appSources(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (['node_modules', '.next', 'dist', '.expo', '.metro-cache'].includes(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      appSources(full, found);
    } else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
      found.push(full);
    }
  }
  return found;
}

describe('client queries and column-level revokes', () => {
  it('keeps its allowlist honest', () => {
    // An entry for a file that no longer exists is a hole nobody notices.
    for (const [file, reason] of Object.entries(SERVICE_ROLE_ONLY)) {
      assert.ok(readFileSync(join(ROOT, file), 'utf8').length > 0, `${file} is allow-listed but missing`);
      assert.ok(reason.length > 20, `${file} needs a reason, not a shrug`);
    }
  });

  it('finds the revokes it is meant to guard', () => {
    // A sanity check on the walker: if the regex stops matching, every
    // assertion below passes vacuously and the guard is silently gone.
    const revoked = revokedColumns();
    assert.ok(revoked.size > 0, 'no column-level revokes found — has the SQL shape changed?');
  });

  it('names no revoked column inside a client .select()', () => {
    const revoked = revokedColumns();
    const offences: string[] = [];

    for (const file of appSources(join(ROOT, 'apps'))) {
      const relative = file.replace(ROOT + '/', '');
      const source = readFileSync(file, 'utf8');
      // Service-role callers may read anything; they are the intended holders
      // of these columns, so only client-session queries are checked.
      if (/serviceDb\(|service_role|SERVICE_ROLE/.test(source)) continue;
      if (SERVICE_ROLE_ONLY[relative]) continue;

      // Pair each `.from('table')` with the `.select(...)` that follows it, so
      // a revoke on one table cannot raise an alarm about another.
      for (const match of source.matchAll(/\.from\(\s*'([^']+)'\s*\)([\s\S]{0,240}?)\.select\(\s*'([^']+)'/g)) {
        const table = match[1] ?? '';
        for (const column of (match[3] ?? '').split(',').map((entry) => entry.trim())) {
          const where = revoked.get(`${table}.${column}`);
          if (where) {
            offences.push(`${relative} selects ${table}.${column}, revoked by ${where}`);
          }
        }
      }
    }

    assert.deepEqual(offences, [], `naming a revoked column fails the WHOLE query:\n  ${offences.join('\n  ')}`);
  });
});
