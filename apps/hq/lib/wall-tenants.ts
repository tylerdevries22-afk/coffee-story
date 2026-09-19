/**
 * Which organizations the staff wall has a build to show.
 *
 * scripts/build-org-web-statics.ts --wall writes /t/<slug>/<surface> only for
 * the tenants applied to the guest apps, and it reads that list from
 * apps/customer/src/tenants/applied.json. Any other organization -- one made in
 * the console, or a tenant folder that was never applied -- has no export, so a
 * frame pointed at its /t/ path paints a 404. Falling back to the environment's
 * configured app instead would be worse: that is another tenant's build shown
 * under this one's name. Reading the file the build reads keeps the two lists
 * from drifting.
 */
import applied from '../../customer/src/tenants/applied.json';

import { withSurfaceUrls, type AppPreview, type AppPreviewKey } from './app-previews';

type SurfaceUrls = Readonly<Record<AppPreviewKey, string | null>>;

const EXPORTED: ReadonlySet<string> = new Set(applied.slugs);

export function hasWallExport(slug: string): boolean {
  return EXPORTED.has(slug);
}

/** Nulls the per-tenant surfaces the wall build never wrote for this slug. */
export function onlyBuiltSurfaces(slug: string, urls: SurfaceUrls): SurfaceUrls {
  if (hasWallExport(slug)) return urls;
  return { ...urls, customer: null, kiosk: null, operator: null };
}

/**
 * Overlays wall URLs where a null means "nothing to show".
 *
 * withSurfaceUrls reads a null as "keep the default", which is right for the
 * unscoped wall and wrong for a tenant's: the default is the environment's
 * configured app, which belongs to some other tenant.
 */
export function withWallSurfaceUrls(
  previews: readonly AppPreview[],
  urls: Readonly<Partial<Record<AppPreviewKey, string | null>>>,
): AppPreview[] {
  return withSurfaceUrls(previews, urls).map((preview) => (urls[preview.key] === null
    ? { ...preview, url: null, source: 'unavailable' }
    : preview));
}
