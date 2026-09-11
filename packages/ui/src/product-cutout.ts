import {
  PRODUCT_CUTOUT_SPEC,
  type ProductCutoutGrade,
} from './product-cutout-spec';

export { PRODUCT_CUTOUT_SPEC, type ProductCutoutGrade } from './product-cutout-spec';

/** Where a cut-out is allowed to appear, and how tall it is there. */
export type ProductCutoutVariant =
  /** The home shelf's feature row. */
  | 'feature'
  /** A kiosk or menu tile. */
  | 'tile'
  /** Fills its container, height following width through `aspect`. */
  | 'hero';

export type ProductCutoutFrame =
  | { kind: 'fixed'; width: number; height: number }
  | { kind: 'fill' };

/**
 * Heights are the design input and widths derive from `aspect`, because the
 * seat contract pins a glass height rather than a bounding box — two cut-outs
 * at the same frame height show two glasses of the same size, which is the
 * whole point.
 */
const FRAMES = {
  feature: { kind: 'fixed', width: 116, height: 207 },
  tile: { kind: 'fixed', width: 72, height: 128 },
  hero: { kind: 'fill' },
} as const satisfies Record<ProductCutoutVariant, ProductCutoutFrame>;

/** Generic so `productCutoutFrame('feature').height` type-checks without narrowing. */
export function productCutoutFrame<V extends ProductCutoutVariant>(
  variant: V,
): (typeof FRAMES)[V] {
  return FRAMES[variant];
}

/**
 * Alpha-weighted colour, over the pixels that are actually visible.
 *
 * Not comparable to `MenuImageMeasurement`, which is a whole-frame mean. Same
 * three axis names, a different statistic, and its own bands.
 */
export type ProductCutoutMeasurement = {
  luminance: number;
  warmth: number;
  saturation: number;
};

/** The alpha bounding box, as fractions of the canvas. */
export type ProductCutoutGeometry = {
  height: number;
  baseline: number;
  centerX: number;
  width: number;
};

export type ProductCutoutMatte = {
  subjectMass: number;
  softEdge: number;
  rimLuminance: number;
  innerLuminance: number;
};

export type ProductCutoutCorrection = {
  brightness: number;
  saturation: number;
  warmth: number;
};

export type ProductCutoutFault =
  | 'luminance'
  | 'warmth'
  | 'saturation'
  | 'height'
  | 'baseline'
  | 'centerX'
  | 'tooWide'
  | 'speckle'
  | 'hardEdge'
  | 'halo';

export type ProductCutoutVerdict = {
  correction: ProductCutoutCorrection;
  /** Non-empty means `correction` is a no-op and the render must be redone. */
  faults: ProductCutoutFault[];
};

export const NO_CUTOUT_CORRECTION: ProductCutoutCorrection = { brightness: 1, saturation: 1, warmth: 0 };

export function isCutoutNoop(correction: ProductCutoutCorrection): boolean {
  return correction.brightness === 1 && correction.saturation === 1 && correction.warmth === 0;
}

/** Tolerance so a corrected value is a true fixed point rather than a near miss. */
function inBand(value: number, [low, high]: readonly [number, number]): boolean {
  const slack = (high - low) * 1e-9;
  return value >= low - slack && value <= high + slack;
}

function nearestEdge(value: number, [low, high]: readonly [number, number]): number {
  return value < low ? low : high;
}

/**
 * Where a trimmed subject lands on the canvas.
 *
 * Pure arithmetic, no image library — this is the unit that guarantees the row
 * rhythm, so it is the one that has to be testable. Feed it three wildly
 * different bounding boxes and all three come back on the same baseline at the
 * same glass height.
 */
export function productCutoutSeat(
  bbox: { width: number; height: number },
  canvas: { width: number; height: number } = PRODUCT_CUTOUT_SPEC,
): { scale: number; left: number; top: number; targetWidth: number; targetHeight: number } {
  const { seat } = PRODUCT_CUTOUT_SPEC;
  const targetHeight = Math.round(canvas.height * seat.glassHeight);
  const scale = targetHeight / bbox.height;
  const targetWidth = Math.round(bbox.width * scale);
  return {
    scale,
    targetWidth,
    targetHeight,
    left: Math.round(canvas.width * seat.centerX - targetWidth / 2),
    top: Math.round(canvas.height * seat.baseline) - targetHeight,
  };
}

/**
 * Three verdicts in one, and only the first is a colour band.
 *
 * Geometry and matte faults can never be corrected — they are properties of the
 * render and the cut-out, not of the grade — so any of them refuses the whole
 * asset. Colour follows the photo module's doctrine exactly: move to the
 * nearest edge, or refuse if that move would be larger than the clamp allows.
 */
export function productCutoutVerdict(
  measured: ProductCutoutMeasurement,
  geometry: ProductCutoutGeometry,
  matte: ProductCutoutMatte,
  grade: ProductCutoutGrade | null = PRODUCT_CUTOUT_SPEC.grade,
): ProductCutoutVerdict {
  const { seat, tolerance, matte: limits, maxCorrection } = PRODUCT_CUTOUT_SPEC;
  const faults: ProductCutoutFault[] = [];

  if (Math.abs(geometry.height - seat.glassHeight) > tolerance.seat) faults.push('height');
  if (Math.abs(geometry.baseline - seat.baseline) > tolerance.seat) faults.push('baseline');
  if (Math.abs(geometry.centerX - seat.centerX) > tolerance.centerX) faults.push('centerX');
  if (geometry.width > seat.maxWidth) faults.push('tooWide');

  if (matte.subjectMass < limits.minSubjectMass) faults.push('speckle');
  if (matte.softEdge < limits.minSoftEdge) faults.push('hardEdge');
  if (matte.rimLuminance - matte.innerLuminance > limits.haloLuminance) faults.push('halo');

  // Before the bands are seeded every colour axis is in band by definition:
  // the batch that seeds them has to be measurable without being judged.
  if (grade === null) {
    return { correction: NO_CUTOUT_CORRECTION, faults };
  }

  const ratio = (
    value: number,
    band: readonly [number, number],
    limit: number,
    axis: ProductCutoutFault,
  ): number => {
    if (inBand(value, band)) return 1;
    const wanted = nearestEdge(value, band) / Math.max(value, 1e-6);
    if (Math.abs(wanted - 1) > limit) {
      faults.push(axis);
      return 1;
    }
    return wanted;
  };

  const brightness = ratio(measured.luminance, grade.luminance.band, maxCorrection.brightness, 'luminance');
  const saturation = ratio(measured.saturation, grade.saturation.band, maxCorrection.saturation, 'saturation');

  // A mid grey moved by `delta` in R and -delta in B shifts (R-B) by about
  // 2*delta, hence the halving before the gap becomes a channel gain.
  let warmth = 0;
  if (!inBand(measured.warmth, grade.warmth.band)) {
    const wanted = (nearestEdge(measured.warmth, grade.warmth.band) - measured.warmth) / 2 / 128;
    if (Math.abs(wanted) > maxCorrection.warmth) faults.push('warmth');
    else warmth = wanted;
  }

  if (faults.length > 0) return { correction: NO_CUTOUT_CORRECTION, faults };
  return { correction: { brightness, saturation, warmth }, faults };
}
