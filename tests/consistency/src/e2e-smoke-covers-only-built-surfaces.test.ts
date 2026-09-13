/**
 * The browser smoke test visits a fixed list of HQ paths. Three of them --
 * `/customer`, `/kiosk`, `/operator` -- are not console pages at all: HQ is
 * the org web host and SPA-rewrites those prefixes to static Expo exports
 * co-located in `apps/hq/public/` (docs/ADR-model-b-org-web.md). That
 * directory is gitignored and is produced by `apps/hq/vercel.json`'s
 * buildCommand, never by `next build`.
 *
 * So the e2e job built HQ without them, served three rewrites pointing at
 * nothing, and `/kiosk returned HTTP 404`. It went unseen for days because
 * `hosted-integration` runs only on push to `main`, is not a required check,
 * and was failing earlier in the job -- at the migration advisor step -- so
 * the e2e suite was skipped every time rather than run.
 *
 * A route list may therefore name a Model B prefix only while the job that
 * walks it also builds the statics behind it. Either both move or neither
 * does.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

const ROOT = join(process.cwd(), '..', '..');
const workflow = readFileSync(join(ROOT, '.github', 'workflows', 'verify.yml'), 'utf8');
const smoke = readFileSync(join(ROOT, 'tests', 'e2e', 'src', 'route-smoke.ts'), 'utf8');

/** The prefixes HQ serves from public/ instead of from app/(console). */
const MODEL_B_PREFIXES = ['/customer', '/kiosk', '/operator'] as const;

/** The HQ_ROUTES array's contents, so a path in another list cannot satisfy this. */
function hqRoutes(): string {
  const start = smoke.indexOf('const HQ_ROUTES');
  assert.ok(start >= 0, 'route-smoke.ts no longer declares HQ_ROUTES -- update this test to find it');
  const end = smoke.indexOf('] as const;', start);
  assert.ok(end > start, 'HQ_ROUTES is not the array literal this test expects');
  return smoke.slice(start, end);
}

describe('the browser smoke test only visits HQ surfaces the job builds', () => {
  const routes = hqRoutes();
  const claimed = MODEL_B_PREFIXES.filter((prefix) => routes.includes(`'${prefix}'`));

  it('found the route list, so the assertions below are not vacuous', () => {
    assert.match(routes, /'\/locations'/, 'HQ_ROUTES no longer looks like the console route list');
  });

  it('builds the co-located static exports whenever it claims one of their prefixes', () => {
    if (claimed.length === 0) return;
    assert.match(workflow, /pnpm tsx scripts\/build-org-web-statics\.ts/,
      `the smoke test visits ${claimed.join(', ')}, which HQ serves from apps/hq/public/, `
      + 'but the e2e job never runs scripts/build-org-web-statics.ts -- those routes will 404');
  });

  it('runs that export before HQ is built, since next build only copies what is already there', () => {
    if (claimed.length === 0) return;
    const exportAt = workflow.indexOf('pnpm tsx scripts/build-org-web-statics.ts');
    const buildAt = workflow.indexOf('pnpm --filter @platform/hq build');
    assert.ok(exportAt >= 0 && buildAt >= 0, 'the e2e build step no longer has both commands');
    assert.ok(exportAt < buildAt,
      'build-org-web-statics.ts must run before the HQ build, or public/ is empty when next build reads it');
  });
});
