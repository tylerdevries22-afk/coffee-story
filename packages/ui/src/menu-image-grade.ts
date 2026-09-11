import { MENU_IMAGE_SPEC } from './menu-image-contract';

/** Whole-frame measurements a normaliser takes before deciding on a correction. */
export type MenuImageMeasurement = {
  /** Rec.709 luminance of the mean colour, 0-255. */
  luminance: number;
  /** Mean red minus mean blue. Positive is warm. */
  warmth: number;
  /**
   * Mean per-pixel HSV saturation, 0-1.
   *
   * Per-pixel, not the saturation of the mean colour: a frame full of vivid
   * greens and pinks averages to near-grey, so measuring the average would read
   * it as washed out and boost it into neon.
   */
  saturation: number;
};

/** Multipliers a normaliser applies. 1 (and warmth 0) means "leave this axis alone". */
export type MenuImageCorrection = {
  brightness: number;
  saturation: number;
  /**
   * Per-channel warmth gain. Red is multiplied by (1 + warmth), blue by
   * (1 - warmth), so positive warms the frame and negative cools it.
   */
  warmth: number;
};

/** The axes of a measurement, for reporting which one put a photo out of reach. */
export type MenuImageAxis = 'luminance' | 'warmth' | 'saturation';

export type MenuImageVerdict = {
  correction: MenuImageCorrection;
  /**
   * Axes whose required correction exceeded `maxCorrection`. Non-empty means
   * `correction` is a no-op and the photograph needs replacing, not grading.
   */
  beyondGrade: MenuImageAxis[];
};

export const NO_CORRECTION: MenuImageCorrection = { brightness: 1, saturation: 1, warmth: 0 };

/**
 * Band membership, with a tolerance proportional to the band width.
 *
 * A correction lands a value exactly on an edge in exact arithmetic, but in
 * floating point it can land a few ulps outside and ask to be corrected again.
 * The tolerance keeps `menuImageCorrection` a true fixed point.
 */
const inBand = (value: number, [low, high]: readonly [number, number]) => {
  const tolerance = (high - low) * 1e-9;
  return value >= low - tolerance && value <= high + tolerance;
};

/** The nearest edge of a band -- where an out-of-band value gets pulled to. */
const nearestEdge = (value: number, [low, high]: readonly [number, number]) => (value < low ? low : high);

/**
 * The correction that pulls one measurement into the house band.
 *
 * Three outcomes, and the middle one is the point:
 *   - in band on every axis: an exact no-op;
 *   - outside, but reachable within `maxCorrection`: the smallest correction
 *     that lands the axis on the nearest band edge, which is why a second pass
 *     is a no-op and the pipeline converges;
 *   - outside by more than `maxCorrection`: no correction at all, and the
 *     offending axes are named. Half-applying a clamped correction is worse
 *     than leaving the photo alone -- it neither matches the house look nor
 *     stays honest to the original.
 */
export function menuImageCorrection(measured: MenuImageMeasurement): MenuImageVerdict {
  const { grade, maxCorrection } = MENU_IMAGE_SPEC;
  const beyondGrade: MenuImageAxis[] = [];

  const ratio = (value: number, band: readonly [number, number], floor: number, limit: number, axis: MenuImageAxis) => {
    if (inBand(value, band)) return 1;
    const wanted = nearestEdge(value, band) / Math.max(value, floor);
    if (Math.abs(wanted - 1) > limit) {
      beyondGrade.push(axis);
      return 1;
    }
    return wanted;
  };

  const brightness = ratio(measured.luminance, grade.luminance.band, 1, maxCorrection.brightness, 'luminance');
  const saturation = ratio(measured.saturation, grade.saturation.band, 0.01, maxCorrection.saturation, 'saturation');

  // A mid grey moved by `delta` in R and -delta in B shifts (R-B) by about
  // 2*delta, hence the halving before turning the gap into a channel gain.
  let warmth = 0;
  if (!inBand(measured.warmth, grade.warmth.band)) {
    const wanted = (nearestEdge(measured.warmth, grade.warmth.band) - measured.warmth) / 2 / 128;
    if (Math.abs(wanted) > maxCorrection.warmth) beyondGrade.push('warmth');
    else warmth = wanted;
  }

  if (beyondGrade.length > 0) return { correction: NO_CORRECTION, beyondGrade };
  return { correction: { brightness, saturation, warmth }, beyondGrade };
}

/** True when a correction would leave the pixels untouched. */
export function isNoop(correction: MenuImageCorrection): boolean {
  return correction.brightness === 1 && correction.saturation === 1 && correction.warmth === 0;
}
