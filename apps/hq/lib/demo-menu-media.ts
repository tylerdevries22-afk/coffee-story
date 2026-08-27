import { resolve } from 'node:path';

const MENU_MEDIA_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Returns safe local fallback locations for a bundled Coffee Story menu image. */
export function demoMenuImagePaths(cwd: string, slug: string): string[] {
  if (!MENU_MEDIA_SLUG.test(slug)) return [];
  return [
    resolve(cwd, 'tenants', 'coffee-story', 'assets', 'menu', `${slug}.webp`),
    resolve(cwd, '..', '..', 'tenants', 'coffee-story', 'assets', 'menu', `${slug}.webp`),
    resolve(cwd, 'apps', 'customer', 'assets', 'menu', `${slug}.webp`),
    resolve(cwd, '..', 'customer', 'assets', 'menu', `${slug}.webp`),
  ];
}
