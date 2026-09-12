/**
 * The HQ route handlers read their deployment configuration from process.env
 * on every request (`serverEnv()` in apps/hq/lib/api-auth.ts), and the
 * integration suites that call those handlers in-process publish the test
 * stack under the same names. Two lists in two packages, and nothing tied
 * them together: the anon key joined what `serverEnv()` requires, the suites
 * kept publishing only the URL and the service-role key, and every route
 * answered 501 `not_configured` -- which read as twelve authorization
 * failures in the security job and blocked every pull request behind it.
 *
 * This pins the lists to each other: every name `serverEnv()` reads is set
 * by `exposeStackToRoutes()`, and every suite that imports a route calls
 * that helper instead of setting the names by hand.
 */
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

const ROOT = join(process.cwd(), '..', '..');
const API_AUTH = join(ROOT, 'apps', 'hq', 'lib', 'api-auth.ts');
const STACK_RUNTIME = join(ROOT, 'tests', 'integration', 'src', 'stack-runtime.ts');
const SUITES = join(ROOT, 'tests', 'integration', 'src');

/** One top-level function's source, from its `export function` to the next export. */
function functionSource(file: string, name: string): string {
  const source = readFileSync(file, 'utf8');
  const start = source.indexOf(`export function ${name}(`);
  assert.ok(start >= 0, `${name} moved or was renamed in ${file} -- update this test to find it`);
  const next = source.indexOf('\nexport ', start + 1);
  return source.slice(start, next === -1 ? undefined : next);
}

function envNames(source: string, pattern: RegExp): string[] {
  const names = [...source.matchAll(pattern)].map((match) => match[1]).filter((name): name is string => Boolean(name));
  return [...new Set(names)].sort();
}

describe('the integration suites publish every env name the HQ routes read', () => {
  const read = envNames(functionSource(API_AUTH, 'serverEnv'), /process\.env\.([A-Z_]+)/g);
  const published = envNames(functionSource(STACK_RUNTIME, 'exposeStackToRoutes'), /process\.env\.([A-Z_]+)\s*=/g);

  it('found the names serverEnv reads, so the comparison below is not vacuous', () => {
    assert.ok(read.includes('SUPABASE_URL'), `serverEnv no longer reads SUPABASE_URL: ${read.join(', ') || 'nothing'}`);
  });

  it('sets every one of them from the stack, and nothing else', () => {
    assert.deepEqual(published, read,
      'serverEnv() and exposeStackToRoutes() disagree about the routes\' env; a route will answer 501 in CI');
  });

  it('routes every suite that calls a handler in-process through the helper', () => {
    const byHand = new RegExp(`process\\.env\\.(${read.join('|')})\\s*=`);
    for (const file of readdirSync(SUITES).filter((name) => name.endsWith('.test.ts'))) {
      const source = readFileSync(join(SUITES, file), 'utf8');
      if (!/apps\/hq\/app\/api\//.test(source)) continue;
      assert.match(source, /exposeStackToRoutes\(\)/, `${file} imports an HQ route but never publishes the stack to it`);
      assert.doesNotMatch(source, byHand, `${file} sets the routes' env by hand; call exposeStackToRoutes instead`);
    }
  });
});
