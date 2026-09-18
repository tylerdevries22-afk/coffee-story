import type { MenuImageCorrection, MenuImageMeasurement } from './menu-image-grade';

/**
 * The arithmetic of measuring and grading a menu photograph, without an image
 * library.
 *
 * Both the tenant normaliser (scripts/normalize-menu-images.ts) and the demo
 * factory in the console grade photographs against the same bands. The pixel
 * plumbing differs by caller, but the numbers must not: a photograph measured
 * as in band by one has to be in band for the other. So the maths lives here,
 * fed with what any image library can report -- the mean of each channel over
 * the whole frame, and a small packed-RGB sample.
 */

/** Edge of the square sample that per-pixel saturation is averaged over. */
export const MENU_MEASURE_SAMPLE = 128;

export type ChannelMeans = { readonly red: number; readonly green: number; readonly blue: number };

const round = (n: number, places = 3): number => Number(n.toFixed(places));

/**
 * Luminance and warmth from the channel means; saturation per pixel of the
 * sample and then averaged, because the saturation of the mean colour reads a
 * vivid, varied frame as grey (see `MenuImageMeasurement`).
 */
export function measureMenuPixels(means: ChannelMeans, rgb: Uint8Array): MenuImageMeasurement {
  const pixels = Math.floor(rgb.length / 3);
  let total = 0;
  for (let i = 0; i < pixels; i++) {
    const red = rgb[i * 3] ?? 0;
    const green = rgb[i * 3 + 1] ?? 0;
    const blue = rgb[i * 3 + 2] ?? 0;
    const max = Math.max(red, green, blue);
    const min = Math.min(red, green, blue);
    total += max === 0 ? 0 : (max - min) / max;
  }
  return {
    luminance: round(0.2126 * means.red + 0.7152 * means.green + 0.0722 * means.blue, 1),
    warmth: round(means.red - means.blue, 1),
    saturation: round(pixels === 0 ? 0 : total / pixels),
  };
}

export type ColourMatrix = [[number, number, number], [number, number, number], [number, number, number]];

/**
 * The channel mix that applies a correction's warmth: red scaled by
 * (1 + warmth), blue by (1 - warmth), green untouched.
 */
export function menuImageWarmthMatrix(correction: Pick<MenuImageCorrection, 'warmth'>): ColourMatrix {
  return [[1 + correction.warmth, 0, 0], [0, 1, 0], [0, 0, 1 - correction.warmth]];
}
