/**
 * Reading a product cut-out's pixels, and measuring what they contain.
 *
 * Extracted from `normalize-product-cutouts.ts` so that file could take a
 * `--tenant` path-traversal guard without growing past the 200-line rule it is
 * already grandfathered against. The split is along a real seam rather than at
 * a convenient line: everything here is pure raster arithmetic over a decoded
 * buffer, with no CLI, no filesystem and no tenant in sight, which is also why
 * it is the half worth testing on its own.
 */
import type { ProductCutoutMeasurement } from '@platform/ui/src/product-cutout';

/** Rounded for the manifest, so a re-run hashes identically. */
export const round = (n: number, places = 3) => Number(n.toFixed(places));

export type Raw = { data: Buffer; width: number; height: number };

/** Anything below this is background as far as the bounding box is concerned. */
const BBOX_ALPHA = 8;

/**
 * A WebP that carries alpha is an extended file (`VP8X`); a simple lossy one
 * (`VP8 `) cannot carry an alpha channel at all.
 *
 * This is the cheapest assertion here and the most valuable, because it catches
 * the likeliest regression by far: someone points a flattening tool at these
 * assets and every one of them comes back opaque, still recognisable, still
 * roughly the right size, and completely wrong. Every asset in `assets/menu/`
 * is `VP8 `; every asset here must be `VP8X`.
 */
export function carriesAlpha(bytes: Buffer): boolean {
  return bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(12, 16).toString('ascii') === 'VP8X';
}


export async function readRaw(sharp: (typeof import('sharp'))['default'], input: Buffer): Promise<Raw> {
  const { data, info } = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

/** The exact alpha bounding box, in pixels. */
export function alphaBox(raw: Raw): { left: number; top: number; width: number; height: number } {
  let minX = raw.width;
  let maxX = -1;
  let minY = raw.height;
  let maxY = -1;
  for (let y = 0; y < raw.height; y++) {
    for (let x = 0; x < raw.width; x++) {
      if ((raw.data[(y * raw.width + x) * 4 + 3] ?? 0) <= BBOX_ALPHA) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) throw new Error('the cut-out is entirely transparent');
  return { left: minX, top: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

/**
 * Alpha-weighted colour over the pixels that actually reach a screen.
 *
 * Saturation is the mean of per-pixel HSV S, not the saturation of the mean
 * colour -- the same reasoning the photograph contract records, where a frame of
 * vivid greens and pinks reads as near-grey and invites a correction that turns
 * it neon.
 */
export function measureCutout(raw: Raw): ProductCutoutMeasurement {
  let mass = 0;
  let r = 0;
  let g = 0;
  let b = 0;
  let sat = 0;
  for (let i = 0; i < raw.width * raw.height; i++) {
    const a = raw.data[i * 4 + 3] ?? 0;
    if (a === 0) continue;
    const red = raw.data[i * 4] ?? 0;
    const green = raw.data[i * 4 + 1] ?? 0;
    const blue = raw.data[i * 4 + 2] ?? 0;
    const max = Math.max(red, green, blue);
    const min = Math.min(red, green, blue);
    mass += a;
    r += a * red;
    g += a * green;
    b += a * blue;
    sat += a * (max === 0 ? 0 : (max - min) / max);
  }
  if (mass === 0) throw new Error('the cut-out is entirely transparent');
  return {
    luminance: round((0.2126 * r + 0.7152 * g + 0.0722 * b) / mass, 1),
    warmth: round((r - b) / mass, 1),
    saturation: round(sat / mass),
  };
}
