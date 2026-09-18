import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  MENU_MEASURE_SAMPLE,
  measureMenuPixels,
  type MenuImageMeasurement,
} from '@platform/ui/src/menu-image';

// The crop centre and the measuring arithmetic moved to @platform/ui so the
// console's demo factory grades exactly as this normaliser does; re-exported
// so existing script imports keep working.
export { MENU_CROP_CENTER } from '@platform/ui/src/menu-image';

export const MENU_SHEET = { cell: 150, columns: 7, label: 16, pad: 12, header: 34 };

export function menuImagePaths(cwd: string, tenantSlug: string) {
  const tenantDir = join(cwd, 'tenants', tenantSlug);
  const menuDir = join(tenantDir, 'assets', 'menu');
  const brand = JSON.parse(readFileSync(join(tenantDir, 'brand.json'), 'utf8')) as {
    identity?: { name?: string };
  };
  return {
    menuDir,
    manifest: join(menuDir, '.normalized.json'),
    contactSheet: join(tenantDir, 'assets', 'menu-images-contact-sheet.png'),
    brandName: brand.identity?.name ?? tenantSlug,
  };
}

export const hashBytes = (buffer: Buffer | Uint8Array) =>
  createHash('sha256').update(buffer).digest('hex');

/** Measure whole-frame colour with a per-pixel HSV saturation mean. */
export async function measureMenuImage(
  image: import('sharp').Sharp,
): Promise<MenuImageMeasurement> {
  const { channels } = await image.clone().stats();
  const [r, g, b] = channels;
  if (!r || !g || !b) throw new Error('expected three colour channels');

  const { data } = await image
    .clone()
    .resize(MENU_MEASURE_SAMPLE, MENU_MEASURE_SAMPLE, { fit: 'fill' })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  return measureMenuPixels({ red: r.mean, green: g.mean, blue: b.mean }, data);
}
