import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

/**
 * `supabase/config.toml:20` exposes only `["public", "storage"]` over
 * PostgREST, by design -- `app` holds RLS/auth-hook helpers, not the REST
 * surface. supabase-js always resolves an unqualified `.rpc(name, ...)`
 * against the EXPOSED schemas, so a function written only into `app` and
 * called by name resolves in `public`, finds nothing, and the caller gets a
 * generic PGRST202 -- indistinguishable from any other 404 at the call site.
 *
 * That happened for real: five device-wall and catalog-publish RPCs lived
 * only in `app` while apps/hq called them unqualified (fixed in
 * 20260912030000 with thin `public.<name>` wrappers). Nothing caught it
 * because typecheck sees a string literal, not a schema, and nothing else in
 * the suite cross-references a `.rpc()` call against what the migrations
 * actually expose. This does, textually, so it can run in `pnpm test`
 * without a live database.
 */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const MIGRATIONS = join(ROOT, 'supabase', 'migrations');
const SCAN_ROOTS = ['apps', 'packages', 'scripts'];

/** Every source file under `dir`, excluding build output and dependencies. */
function sourceFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (['node_modules', '.next', 'dist', '.expo', '.metro-cache', 'coverage'].includes(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      sourceFiles(full, found);
    } else if (/\.tsx?$/.test(entry)) {
      found.push(full);
    }
  }
  return found;
}

/** Every distinct name passed as a string literal to `.rpc(...)`, across every scanned root. */
function calledRpcNames(): Set<string> {
  const names = new Set<string>();
  for (const root of SCAN_ROOTS) {
    for (const file of sourceFiles(join(ROOT, root))) {
      const source = readFileSync(file, 'utf8');
      for (const match of source.matchAll(/\.rpc\(\s*['"]([a-zA-Z0-9_]+)['"]/g)) {
        const name = match[1];
        if (name) names.add(name);
      }
    }
  }
  return names;
}

/** Every function PostgREST can resolve unqualified: `create [or replace] function public.<name>`. */
function publicFunctionNames(): Set<string> {
  const names = new Set<string>();
  for (const file of readdirSync(MIGRATIONS).filter((name) => name.endsWith('.sql'))) {
    const sql = readFileSync(join(MIGRATIONS, file), 'utf8');
    for (const match of sql.matchAll(/create\s+(?:or\s+replace\s+)?function\s+public\.([a-zA-Z0-9_]+)/gi)) {
      const name = match[1];
      if (name) names.add(name);
    }
  }
  return names;
}

describe('rpc names resolve in public', () => {
  it('finds enough calls that the guard is measuring something', () => {
    // A sanity check on the walker: if the regex or the scanned roots stop
    // matching reality, every assertion below would pass vacuously.
    const found = calledRpcNames().size;
    assert.ok(found >= 50, `expected at least 50 distinct .rpc() names, found ${found}`);
  });

  it('every called RPC name has a public function PostgREST can resolve', () => {
    const called = calledRpcNames();
    const resolvable = publicFunctionNames();
    const unresolved = [...called].filter((name) => !resolvable.has(name)).sort();
    assert.deepEqual(
      unresolved,
      [],
      'these .rpc() names have no "create function public.<name>" in supabase/migrations, ' +
        `so PostgREST cannot resolve them and every call fails PGRST202:\n  ${unresolved.join('\n  ')}`,
    );
  });
});
