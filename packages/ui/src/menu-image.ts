/**
 * The menu imagery contract (rule 4, extended to photography).
 *
 * Menu photographs used to be normalised by nothing at all: 61 assets stored at
 * 600x682 with subject scale varying 2-3x, whole-frame luminance spanning
 * 30-158, and six render sites each cover-cropping that portrait source into a
 * different shape -- 56/76/64/72 squares, a 1.5:1 hero, a 3:1 services card.
 * The same drink therefore appeared at a different size, and showing a
 * different slice of itself, on every screen it touched.
 *
 * This module is the single source of truth that fixes that. It is deliberately
 * asset-free so `node:test` can reach it: the geometry feeds the render layer,
 * and the same numbers feed `scripts/normalize-menu-images.ts`, so a photo that
 * passes the audit is a photo the app can frame.
 *
 * The rule that makes it work: **menu images are square.** Every surface then
 * shows the identical crop of the subject and only the display size changes.
 */

/** Canonical master: square, and large enough for the full-width hero. */
export const MENU_IMAGE_SPEC = {
  /** Every menu asset is stored 1:1. Non-square sources are centre-cropped. */
  aspect: 1,
  /** Stored edge length in pixels. */
  edge: 900,
  /** WebP quality for the stored master. */
  quality: 82,
  /**
   * The house grade, measured over the whole frame.
   *
   * Bands are set from the 50 in-house shots so that every one of them passes
   * untouched -- a black americano is legitimately darker than a matcha, and
   * flattening the menu to a single number would destroy its variety. They are
   * wide on purpose. What they catch is the tail: photographs whose exposure or
   * colour cast puts them outside the range the house look ever produces.
   *
   * Measured house range was luminance 31-84, warmth 32-100, saturation
   * 0.46-0.88. Measured off-spec range was luminance 73-158, warmth -3 to 92,
   * saturation 0.17-0.62.
   *
   * An out-of-band photo is pulled to the *nearest edge*, never to a midpoint.
   * That keeps every correction the smallest one that does the job, and means a
   * corrected value lands exactly in band -- so a second pass is a no-op.
   */
  grade: {
    luminance: { band: [30, 72] as const },
    warmth: { band: [30, 102] as const },
    saturation: { band: [0.45, 0.9] as const },
  },
  /**
   * How far a single axis may be moved. A correction larger than this is not
   * applied at all -- see `menuImageCorrection`. Pushing a washed-out phone
   * snapshot 2.5x on saturation does not make it match the house look, it makes
   * it neon; the honest outcome is to report it for reshooting.
   */
  maxCorrection: { brightness: 0.45, saturation: 0.25, warmth: 0.1 },
} as const;

/** Where a menu image is allowed to appear, and how big it is there. */
export type MenuImageVariant =
  /** Home screen menu row. */
  | 'thumb'
  /** Order flow menu list row. */
  | 'row'
  /** Bag line item. */
  | 'line'
  /** Drop row on the drops page. */
  | 'tile'
  /** Item sheet hero and the services card -- both full bleed, both square. */
  | 'hero';

export type MenuImageFrame =
  | { kind: 'fixed'; size: number; radius: 'sm' | 'md' }
  | { kind: 'fill'; radius: 'sm' | 'md' | 'none' };

const FRAMES = {
  thumb: { kind: 'fixed', size: 56, radius: 'sm' },
  line: { kind: 'fixed', size: 64, radius: 'sm' },
  tile: { kind: 'fixed', size: 72, radius: 'md' },
  row: { kind: 'fixed', size: 76, radius: 'md' },
  hero: { kind: 'fill', radius: 'none' },
} as const satisfies Record<MenuImageVariant, MenuImageFrame>;

/**
 * Generic in the variant so a caller that names one gets its exact frame back
 * -- `menuImageFrame('line').size` type-checks without a narrowing dance, which
 * is what lets an empty-state placeholder size itself from the real contract
 * instead of hard-coding a number that can drift.
 */
export function menuImageFrame<V extends MenuImageVariant>(variant: V): (typeof FRAMES)[V] {
  return FRAMES[variant];
}

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
