import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Apply the forward-only migration chain to a local PostgreSQL and run every
 * release assertion, without Docker and without CI.
 *
 * The gate this repository relies on is structurally blind on pull requests:
 * `hosted-integration` is the only job with a database and it is gated to
 * non-PR events by design, so branch code never holds the project-creation
 * token. The consequence is that a migration, an RLS policy or a readiness
 * assertion can be wrong for a full day and every PR still reports green.
 *
 * That is not hypothetical. `20260903210000` shipped an assertion that could
 * never pass -- it tested `proconfig @> array['search_path=']` when PostgreSQL
 * stores an empty search_path as `search_path=""` -- and because the readiness
 * head runs every registered assertion, the whole release gate went red and
 * stayed red. It took four CI round-trips to even see the message, because the
 * step's own diagnostics were unreachable behind `set -e`. Applying the chain
 * locally named the failing assertion on the first try, in seconds.
 *
 * So this is the fast loop for anything schema-shaped: it answers "does the
 * chain apply" and "does every assertion hold" before a branch is pushed.
 *
 * Usage:
 *   pnpm db:local              apply the chain to a scratch database and report
 *   pnpm db:local --keep       leave the database in place to poke at
 *   pnpm db:local --database x use a specific database name
 *
 * Requires `psql` and `createdb` on PATH (Homebrew PostgreSQL is enough) and a
 * server this user can create databases on. It is NOT a substitute for the
 * hosted gate: nothing here authenticates a request or exercises the edge.
 */
const ROOT = join(import.meta.dirname, '..');
const MIGRATIONS = join(ROOT, 'supabase/migrations');
const SHIM = join(ROOT, 'scripts/local-supabase-shim.sql');
/** Long enough for the largest migration, short enough to fail rather than hang. */
const STATEMENT_TIMEOUT_MS = 120_000;

interface Options {
  readonly database: string;
  readonly keep: boolean;
}

function parseOptions(argv: readonly string[]): Options {
  const at = argv.indexOf('--database');
  // Bound to a local because a re-read of argv[at + 1] is not narrowed by the
  // truthiness check under noUncheckedIndexedAccess.
  const named = at >= 0 ? argv[at + 1] : undefined;
  return {
    database: named && named.length > 0 ? named : 'coffee_story_local_chain',
    keep: argv.includes('--keep'),
  };
}

/** `psql` against the scratch database, returning stdout with stderr folded in. */
function psql(database: string, args: readonly string[]): string {
  return execFileSync('psql', ['-d', database, '-v', 'ON_ERROR_STOP=1', ...args], {
    encoding: 'utf8',
    timeout: STATEMENT_TIMEOUT_MS,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function query(database: string, sql: string): string {
  return psql(database, ['-Atqc', sql]).trim();
}

/** The message PostgreSQL raised, without psql's framing or a stack of context. */
function raisedMessage(error: unknown): string {
  const parts = error as { stdout?: string; stderr?: string; message?: string };
  const text = `${parts.stderr ?? ''}\n${parts.stdout ?? ''}\n${parts.message ?? ''}`;
  const line = text.split('\n').find((candidate) => candidate.includes('ERROR:'));
  return (line ?? text.split('\n')[0] ?? 'unknown failure').replace(/^.*ERROR:\s*/, '').trim();
}

function recreateDatabase(database: string): void {
  try {
    execFileSync('dropdb', ['--if-exists', database], { stdio: 'ignore', timeout: 30_000 });
  } catch {
    // A database that was never created, or is held open by another session.
    // `createdb` below reports the real problem, so nothing is hidden here.
  }
  execFileSync('createdb', [database], { stdio: 'inherit', timeout: 30_000 });
}

function applyChain(database: string): string[] {
  const files = readdirSync(MIGRATIONS).filter((name) => name.endsWith('.sql')).sort();
  if (files.length === 0) throw new Error(`no migrations under ${MIGRATIONS}`);
  for (const name of files) {
    try {
      // One transaction per migration, which is what the Supabase CLI does --
      // and what `create temporary table ... on commit drop` depends on.
      psql(database, ['-q', '--single-transaction', '-f', join(MIGRATIONS, name)]);
    } catch (error) {
      throw new Error(`${name}\n    ${raisedMessage(error)}`);
    }
  }
  return files;
}

/** Every assertion the readiness head would run, evaluated one at a time. */
function runAssertions(database: string): { failures: number; total: number } {
  const registered = query(
    database,
    "select assertion::text from app.release_assertions where assertion is not null order by release",
  );
  const assertions = registered.split('\n').map((line) => line.trim()).filter(Boolean);
  let failures = 0;
  for (const assertion of assertions) {
    try {
      query(database, `select ${assertion}`);
      console.log(`  pass  ${assertion}`);
    } catch (error) {
      failures += 1;
      console.log(`  FAIL  ${assertion}\n          ${raisedMessage(error)}`);
    }
  }
  return { failures, total: assertions.length };
}

function main(): void {
  const options = parseOptions(process.argv.slice(2));
  recreateDatabase(options.database);
  psql(options.database, ['-q', '-f', SHIM]);
  // One migration adds a table to this publication; it is created by Supabase.
  try {
    query(options.database, 'create publication supabase_realtime');
  } catch {
    // Already present on a re-run against a kept database.
  }

  let files: string[];
  try {
    files = applyChain(options.database);
  } catch (error) {
    console.error(`\nThe chain stopped applying at:\n    ${(error as Error).message}\n`);
    process.exitCode = 1;
    return;
  }
  console.log(`\nApplied ${files.length} migrations.\n\nRelease assertions:`);

  const { failures, total } = runAssertions(options.database);
  const newest = files[files.length - 1] ?? '';
  const expected = newest.split('_')[0] ?? '';
  let head = '';
  try {
    head = query(options.database, 'select public.platform_release_readiness()');
  } catch (error) {
    head = `raised: ${raisedMessage(error)}`;
  }

  console.log(`\nreadiness head: ${head}\nnewest migration: ${newest} (expects ${expected})`);
  if (failures > 0 || head !== expected) {
    console.error(`\n${failures} of ${total} assertions failed; the release gate would be red.`);
    process.exitCode = 1;
  } else {
    console.log(`\nAll ${total} assertions hold and the head matches the newest migration.`);
  }
  if (!options.keep) {
    execFileSync('dropdb', ['--if-exists', options.database], { stdio: 'ignore', timeout: 30_000 });
  } else {
    console.log(`\nKept database "${options.database}".`);
  }
}

main();
