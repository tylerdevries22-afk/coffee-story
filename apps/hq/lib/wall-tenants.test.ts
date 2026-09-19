import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { appPreviewsFor } from './app-previews';
import { tenantPathSurfaceUrls } from './org-surface-urls';
import { hasWallExport, onlyBuiltSurfaces, withWallSurfaceUrls } from './wall-tenants';

// The same file scripts/build-org-web-statics.ts --wall reads to decide what to export.
const applied = JSON.parse(
  readFileSync(join(process.cwd(), '..', 'customer', 'src', 'tenants', 'applied.json'), 'utf8'),
) as { slugs: string[] };

const UNAPPLIED = 'never-applied-org';

describe('wall tenants', () => {
  it('knows exactly the tenants the wall build exports', () => {
    assert.ok(applied.slugs.length > 0, 'applied.json lists no tenants -- this test would be vacuous');
    for (const slug of applied.slugs) assert.equal(hasWallExport(slug), true, slug);
    assert.equal(hasWallExport(UNAPPLIED), false);
  });

  it('keeps every surface for an applied tenant', () => {
    const slug = applied.slugs[0] ?? '';
    const urls = tenantPathSurfaceUrls('', slug, null);
    assert.deepEqual(onlyBuiltSurfaces(slug, urls), urls);
  });

  it('drops the per-tenant surfaces the build never wrote', () => {
    const urls = onlyBuiltSurfaces(UNAPPLIED, tenantPathSurfaceUrls('', UNAPPLIED, 'loc-1'));
    assert.equal(urls.customer, null);
    assert.equal(urls.kiosk, null);
    assert.equal(urls.operator, null);
    // HQ and the display preview are routes on this origin, not static exports.
    assert.equal(urls.hq, '/');
    assert.equal(urls.display, '/wall/preview/loc-1');
  });

  it("never falls back to another tenant's configured app", () => {
    const environment = {
      NODE_ENV: 'production',
      NEXT_PUBLIC_CUSTOMER_URL: 'https://coffee-story-customer.vercel.app/',
    };
    const previews = withWallSurfaceUrls(
      appPreviewsFor(environment),
      onlyBuiltSurfaces(UNAPPLIED, tenantPathSurfaceUrls('', UNAPPLIED, null)),
    );
    const customer = previews.find((preview) => preview.key === 'customer');
    assert.equal(customer?.url, null);
    assert.equal(customer?.source, 'unavailable');
  });

  it('lets a lobby or partner URL fill a surface the build did not write', () => {
    const urls = {
      ...onlyBuiltSurfaces(UNAPPLIED, tenantPathSurfaceUrls('', UNAPPLIED, null)),
      kiosk: `/lobby/${UNAPPLIED}/loc-1`,
    };
    const previews = withWallSurfaceUrls(appPreviewsFor({ NODE_ENV: 'production' }), urls);
    assert.equal(previews.find((preview) => preview.key === 'kiosk')?.url, `/lobby/${UNAPPLIED}/loc-1`);
    assert.equal(previews.find((preview) => preview.key === 'operator')?.url, null);
  });
});
