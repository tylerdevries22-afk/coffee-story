import { resolve } from 'node:path';

const MENU_MEDIA_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * The brand the console's zero-infrastructure demo renders.
 *
 * Named rather than inferred: the customer app now applies its tenants under
 * `assets/menu/<slug>/`, and "whichever tenant that app happens to be built
 * for" is not what the HQ demo means.
 */
const DEMO_TENANT = 'coffee-story';

/** Returns safe local fallback locations for a bundled Coffee Story menu image. */
export function demoMenuImagePaths(cwd: string, slug: string): string[] {
  if (!MENU_MEDIA_SLUG.test(slug)) return [];
  return [
    resolve(cwd, 'tenants', 'coffee-story', 'assets', 'menu', `${slug}.webp`),
    resolve(cwd, '..', '..', 'tenants', 'coffee-story', 'assets', 'menu', `${slug}.webp`),
    resolve(cwd, 'apps', 'customer', 'assets', 'menu', DEMO_TENANT, `${slug}.webp`),
    resolve(cwd, '..', 'customer', 'assets', 'menu', DEMO_TENANT, `${slug}.webp`),
  ];
}
