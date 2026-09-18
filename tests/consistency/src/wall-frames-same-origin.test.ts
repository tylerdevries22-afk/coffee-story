/**
 * The staff wall previews whichever organization the console has selected, and
 * for a long time it showed nothing useful for any of them: a deployed tenant
 * painted white, an undeployed one showed Vercel's 404.
 *
 * Neither was a broken guest app. Every hosted surface answers
 * `frame-ancestors 'self'` (apps/hq/next.config.ts), so a frame pointed at
 * another origin is refused by the browser and renders blank -- the security
 * header working exactly as written. A missing deployment sends no CSP at all,
 * which is why the 404 page framed fine and the working app did not.
 *
 * The wall therefore has to stay on its own origin, and each tenant needs its
 * own copy there, or one organization's apps are shown under another
 * organization's name. These assertions pin all three halves of that: the page
 * must not force the hosted stack, the origin must serve /t/<slug>/, and the
 * build must write a copy per applied tenant.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

const ROOT = join(process.cwd(), '..', '..');
const read = (...parts: string[]): string => readFileSync(join(ROOT, ...parts), 'utf8');

describe('the apps wall frames surfaces it can actually render', () => {
  it('does not force the hosted stack, which no other origin may frame', () => {
    const page = read('apps', 'hq', 'app', '(console)', 'apps', 'page.tsx');
    assert.doesNotMatch(page, /COFFEE_STORY_WALL_HOSTED:\s*slug/,
      'forcing the hosted stack points every frame at an origin whose '
      + "frame-ancestors 'self' refuses it, so the wall paints blank");
    assert.match(page, /tenantPathSurfaceUrls\(/,
      'the wall must resolve same-origin per-tenant surfaces');
  });

  it('keeps every derived guest surface on the calling origin', () => {
    const urls = read('apps', 'hq', 'lib', 'org-surface-urls.ts');
    const start = urls.indexOf('export function tenantPathSurfaceUrls');
    assert.ok(start >= 0, 'tenantPathSurfaceUrls moved -- update this test to find it');
    const body = urls.slice(start, urls.indexOf('\nexport ', start + 1));
    assert.doesNotMatch(body, /https?:\/\//,
      'a cross-origin surface in the wall is refused by frame-ancestors');
    assert.match(body, /\/t\/\$\{slug\}\/customer/);
  });

  it('serves the tenant prefix, and does not let the catch-all swallow it', () => {
    const config = read('apps', 'hq', 'next.config.ts');
    assert.match(config, /source: '\/t\/:slug\/:surface\(customer\|kiosk\|operator\)'/,
      'the tenant prefix needs a rewrite or every per-tenant surface 404s');
    assert.match(config, /source: '\/t\/:slug\/:path\*', headers: modelBHeaders/,
      'the tenant prefix must carry the Model B headers, not the strict default');
    assert.match(config, /\(\?!api\/\|wall\/preview\/\|t\//,
      'the catch-all header rule must exclude the tenant prefix');
  });

  it('builds one copy per applied tenant, so a switch is not a relabelling', () => {
    const script = read('scripts', 'build-org-web-statics.ts');
    assert.match(script, /applied\.json/,
      'the wall build must read the applied tenants rather than one slug');
    assert.match(script, /`\/t\/\$\{slug\}\$\{surface\.baseUrl\}`/,
      'each tenant needs its own base url or its assets resolve to another tenant');
  });

  it('writes those copies in the deployment that serves the wall', () => {
    // Every assertion above was true while production still 404'd every
    // frame: the script could write /t/<slug>/, but HQ was built without the
    // flag that asks it to.
    const vercel = JSON.parse(read('apps', 'hq', 'vercel.json')) as { buildCommand?: string };
    assert.match(vercel.buildCommand ?? '', /scripts\/build-org-web-statics\.ts --wall/,
      "HQ's deploy must pass --wall, or /t/<slug>/ exists only on a laptop");
  });

  it('offers only the tenants the build wrote, from the same list', () => {
    const page = read('apps', 'hq', 'app', '(console)', 'apps', 'page.tsx');
    assert.match(page, /onlyBuiltSurfaces\(slug, tenantPathSurfaceUrls\(/,
      'an organization with no /t/ copy must get no frame, not a 404');
    const wall = read('apps', 'hq', 'lib', 'wall-tenants.ts');
    assert.match(wall, /from '\.\.\/\.\.\/customer\/src\/tenants\/applied\.json'/,
      'the wall must read the applied list the build reads, or the two drift');
  });
});
