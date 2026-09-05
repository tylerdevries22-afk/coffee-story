import { rmSync } from 'node:fs';
import { join } from 'node:path';

import { GUEST_APPS, slotsDirectory, type GuestApp } from '../onboard-tenant-barrel.js';

function omittedApps(surfaces: readonly GuestApp[]): readonly GuestApp[] {
  return GUEST_APPS.filter((app) => !surfaces.includes(app));
}

function remove(paths: readonly string[]): void {
  for (const path of paths) rmSync(path, { recursive: true, force: true });
}

/** Removes only this slug's generated config and menu media from omitted apps. */
export function reconcileTenantSlots(
  root: string,
  slug: string,
  surfaces: readonly GuestApp[],
): void {
  for (const app of omittedApps(surfaces)) {
    remove([
      join(slotsDirectory(root, app), slug),
      join(root, 'apps', app, 'assets', 'menu', slug),
      join(root, 'apps', app, 'assets', 'products', slug),
    ]);
  }
}

/** Removes only this slug's icons and illustrations from omitted apps. */
export function reconcileTenantArtwork(
  root: string,
  slug: string,
  surfaces: readonly GuestApp[],
): void {
  for (const app of omittedApps(surfaces)) {
    remove([join(root, 'apps', app, 'assets', 'tenants', slug)]);
    if (app === 'customer') remove([join(root, 'apps', app, 'public', 'tenants', slug)]);
  }
}
