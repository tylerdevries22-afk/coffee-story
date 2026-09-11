import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { MenuImageMeasurement } from '@platform/ui/src/menu-image';

export const MENU_SHEET = { cell: 150, columns: 7, label: 16, pad: 12, header: 34 };
export const MENU_CROP_CENTER = 0.55;

const SAMPLE = 128;
const round = (n: number, places = 3) => Number(n.toFixed(places));

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
    .resize(SAMPLE, SAMPLE, { fit: 'fill' })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  let total = 0;
  const pixels = data.length / 3;
  for (let i = 0; i < pixels; i++) {
    const red = data[i * 3] ?? 0;
    const green = data[i * 3 + 1] ?? 0;
    const blue = data[i * 3 + 2] ?? 0;
    const max = Math.max(red, green, blue);
    const min = Math.min(red, green, blue);
    total += max === 0 ? 0 : (max - min) / max;
  }

  return {
    luminance: round(0.2126 * r.mean + 0.7152 * g.mean + 0.0722 * b.mean, 1),
    warmth: round(r.mean - b.mean, 1),
    saturation: round(total / pixels),
  };
}
