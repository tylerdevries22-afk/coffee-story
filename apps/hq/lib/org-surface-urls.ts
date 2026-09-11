/** Per-organization surface URL registry for the staff-gated apps wall. */
import type { AppPreviewKey } from './app-previews';

export type OrgSurfaceUrls = Readonly<Partial<Record<AppPreviewKey, string>>>;

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Model B default: one HQ org host with path-prefixed guest surfaces.
 * Display stays on a dedicated Next project until Vercel Services can co-host.
 * Optional overrides let a tenant keep a non-standard display path or host.
 */
export function hostedSurfaceUrlsForSlug(
  slug: string,
  overrides: OrgSurfaceUrls = {},
): Record<AppPreviewKey, string> {
  if (!SLUG.test(slug)) {
    throw new Error(`Tenant slug must be a lowercase hyphenated slug (got ${slug}).`);
  }
  const hq = `https://${slug}-hq.vercel.app`;
  const defaults: Record<AppPreviewKey, string> = {
    hq: `${hq}/`,
    customer: `${hq}/customer`,
    operator: `${hq}/operator`,
    kiosk: `${hq}/kiosk`,
    display: `https://${slug}-display.vercel.app/board/demo`,
  };
  return {
    hq: overrides.hq ?? defaults.hq,
    customer: overrides.customer ?? defaults.customer,
    operator: overrides.operator ?? defaults.operator,
    kiosk: overrides.kiosk ?? defaults.kiosk,
    display: overrides.display ?? defaults.display,
  };
}

/** Optional per-tenant overrides (rare). Empty = pure Model B derivation. */
const HOSTED_OVERRIDES: Readonly<Record<string, OrgSurfaceUrls>> = {};

const LOCAL_URLS: Readonly<Record<AppPreviewKey, string>> = {
  hq: '/',
  customer: 'http://localhost:4170/',
  operator: 'http://localhost:4191/',
  kiosk: 'http://localhost:4180/',
  display: 'http://localhost:3200/board/demo',
};

/** Model B shape: one origin, path-routed surfaces. */
export function pathBasedSurfaceUrls(origin: string): Record<AppPreviewKey, string> {
  const base = origin.replace(/\/$/, '');
  return {
    hq: `${base}/`,
    customer: `${base}/customer`,
    operator: `${base}/operator`,
    kiosk: `${base}/kiosk`,
    display: `${base}/display/board/demo`, // overlay with *-display until Services
  };
}

function allowedUrl(value: string | undefined): string | null {
  if (!value?.trim()) return null;
  try {
    const url = new URL(value.trim());
    const ok = url.protocol === 'https:'
      || (url.protocol === 'http:' && LOOPBACK.has(url.hostname));
    return ok && !url.username && !url.password ? url.toString() : null;
  } catch {
    return null;
  }
}

/**
 * Resolves surface URLs for one tenant slug.
 * Preference: explicit path-based origin env → hosted Model B derivation → local loopback.
 */
export function surfaceUrlsForTenant(
  slug: string | null | undefined,
  environment: Readonly<Record<string, string | undefined>> = process.env,
): Record<AppPreviewKey, string | null> {
  const pathOrigin = allowedUrl(environment.NEXT_PUBLIC_ORG_SURFACE_ORIGIN);
  if (pathOrigin) {
    const pathUrls = pathBasedSurfaceUrls(pathOrigin.replace(/\/$/, ''));
    const hostedDisplay = slug && SLUG.test(slug)
      ? allowedUrl(hostedSurfaceUrlsForSlug(slug, HOSTED_OVERRIDES[slug]).display)
      : null;
    const envDisplay = allowedUrl(environment.NEXT_PUBLIC_DISPLAY_URL);
    return {
      ...pathUrls,
      display: envDisplay ?? hostedDisplay ?? pathUrls.display,
    };
  }
  const hosted = slug && SLUG.test(slug)
    ? hostedSurfaceUrlsForSlug(slug, HOSTED_OVERRIDES[slug])
    : undefined;
  const preferLocal = environment.NODE_ENV !== 'production'
    || environment.COFFEE_STORY_LOCAL_PREVIEWS === '1';
  const preferHosted = environment.COFFEE_STORY_WALL_HOSTED === '1'
    || environment.NODE_ENV === 'production';
  const keys = Object.keys(LOCAL_URLS) as AppPreviewKey[];
  return Object.fromEntries(keys.map((key) => {
    const fromHosted = allowedUrl(hosted?.[key]);
    if (preferHosted && fromHosted) return [key, fromHosted];
    if (preferLocal) return [key, LOCAL_URLS[key]];
    return [key, fromHosted];
  })) as Record<AppPreviewKey, string | null>;
}

export function knownHostedTenantSlugs(): readonly string[] {
  // Derivation works for any slug; overrides list is not the catalog.
  return Object.keys(HOSTED_OVERRIDES);
}
