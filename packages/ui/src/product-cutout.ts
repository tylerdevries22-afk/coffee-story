/**
 * The product cut-out contract — a drink standing in a glass, on transparency.
 *
 * A second asset class beside the menu photograph, deliberately never merged
 * with it. Three reasons, in force order:
 *
 *   1. Square is the load-bearing rule of `MENU_IMAGE_SPEC`, and a glass is
 *      portrait. A portrait variant would not extend that contract, it would
 *      repeal it.
 *   2. The photo grade measures a background a cut-out does not have. Luminance
 *      30-72 measures a dim café interior and warmth 30-102 measures tungsten
 *      on walnut; `menuImageCorrection` is tuned so no in-house photograph is
 *      ever flagged, against 50 measured photographs and zero cut-outs.
 *   3. `MenuImageMeasurement` would otherwise mean two different things
 *      depending on which file described it — whole-frame mean here, alpha-
 *      weighted opaque mean there — which is exactly the drift these modules
 *      exist to prevent.
 *
 * What is inherited is the doctrine, not the numbers: refuse rather than clamp,
 * pull only as far as the nearest band edge, and keep the bands wide enough
 * that every in-house asset passes untouched.
 *
 * Asset-free so `node:test` can reach it. The same numbers feed the render
 * layer and `scripts/normalize-product-cutouts.ts`, so a cut-out that passes
 * the audit is a cut-out the app can seat.
 *
 * The rule that makes it work: **every cut-out is seated, not framed.** The
 * subject is trimmed to its own alpha, scaled to one glass height and stood on
 * one baseline, so a wide drink and a narrow one share a rim line rather than a
 * bounding box. Fit the bounding box instead and a shelf of six staggers.
 */

/** Canonical master: portrait, seated, and carrying real alpha. */
export const PRODUCT_CUTOUT_SPEC = {
  /**
   * 9:16. A glass can is roughly 1:2, and the rest is room either side for a
   * domed lid or a garnish without tripping `seat.maxWidth`.
   *
   * The render frames derive their width from their height through this, so
   * `contentFit="contain"` can never letterbox a correctly seated asset.
   */
  aspect: 720 / 1280,
  width: 720,
  height: 1280,
  /**
   * Lossy WebP carries alpha (VP8X + ALPH) and was measured against the
   * alternatives on a real cut-out: q82 + alpha 17.7 KB, lossless 134.9 KB
   * (7.6x), AVIF q60 37.1 KB (2.1x, plus an Android decode risk), PNG 1454 KB.
   * `alphaQuality` made no difference to size at any value, so it is pinned
   * open — the alpha plane is the one part of a cut-out worth spending on.
   */
  quality: 82,
  alphaQuality: 100,
  effort: 6,
  /**
   * Where the trimmed subject is stood, as fractions of the canvas.
   *
   * `glassHeight` is what every subject is scaled to — by height, never by
   * bounding-box fit. `baseline` is where its foot lands. `maxWidth` is not a
   * clamp: a subject wider than this after height-scaling is a render failure
   * (`tooWide`) and gets regenerated, the same way an off-grade photograph gets
   * reshot rather than half-corrected.
   *
   * Tight on purpose. The first cut used 0.78 / 0.94, which left 22% of the
   * canvas as empty margin — and because a render frame has to be the master's
   * whole aspect for `contain` to be exact, that margin came straight through
   * into the layout as dead space. The glass floated inside its own box and the
   * contact shadow, pinned to the box rather than to the drink, detached.
   *
   * Measured subject widths across the first batch were 0.51-0.66 of the
   * canvas at the old height, so filling the frame vertically still leaves the
   * widest of them comfortably inside `maxWidth`.
   */
  seat: { glassHeight: 0.92, baseline: 0.98, centerX: 0.5, maxWidth: 0.86 },
  tolerance: { seat: 0.005, centerX: 0.01 },
  /**
   * The failures background removal actually produces, which no colour band
   * can see.
   *
   * `minSoftEdge` is the one that earns its keep: a cut-out with no partially
   * transparent perimeter is a hard-thresholded mask, and it reads jagged at 2x
   * where nobody catches it at thumbnail size.
   */
  matte: {
    /** Largest connected opaque region, as a share of total alpha mass. */
    minSubjectMass: 0.99,
    /** Share of the subject perimeter that is partially transparent. */
    minSoftEdge: 0.35,
    /**
     * How much brighter the rim may be than the body before it reads as a
     * halo, 0-255.
     *
     * One-directional on purpose. A light matte left behind by background
     * removal makes the rim *brighter* than the body it surrounds. The
     * symmetric version of this check flags the opposite case too — and the
     * opposite case is just "this is a pale drink": a matcha over a white milk
     * base measures an inner body 30 points brighter than its own glass rim,
     * with nothing wrong with it at all. Both pale drinks in the first batch
     * tripped it before this was fixed.
     */
    haloLuminance: 18,
    /**
     * How far the edge colour is bled outward under the transparency.
     *
     * Verified: sharp preserves the RGB beneath `alpha = 0` at every
     * `alphaQuality`, so the invisible region is real data that affects nothing
     * visually and everything measurably. Bleeding stops a client-side sampler
     * pulling a dark fringe in off the rim; zeroing everything beyond the bleed
     * makes the file byte-reproducible, so the manifest hash means something.
     */
    bleedPx: 4,
  },
  /**
   * Seeded from the measured batch, not invented — the same discipline
   * `docs/MENU-IMAGERY.md` records, where the first cut of the photograph
   * pipeline guessed, clamped, and turned washed-out snapshots neon.
   *
   * Measured over the first six cut-outs (alpha-weighted, opaque pixels only):
   * luminance 164.6-184.8, warmth -26.7-59.7, saturation 0.083-0.361. The
   * spread on warmth and saturation is real variety, not error: an amber chai
   * and a grey Earl Grey belong on the same shelf.
   *
   * Padded by half the observed range on each side, which is generous on
   * purpose — six samples is too few to set a tight band, and the job here is
   * to catch the tail (a render that came back dark, washed out or neon), not
   * to police a 5% difference between two teas. Saturation's floor is half the
   * observed minimum instead, because half a range below 0.083 is negative and
   * an axis that can never fire is not a check. Tighten these as the library
   * grows.
   *
   * `null` is still meaningful: it means the bands have not been seeded for a
   * tenant yet, and the colour axes do not judge.
   */
  grade: {
    luminance: { band: [154, 195] as const },
    warmth: { band: [-70, 103] as const },
    saturation: { band: [0.04, 0.5] as const },
  } as ProductCutoutGrade | null,
  /** How far a single axis may be moved before the render is refused instead. */
  maxCorrection: { brightness: 0.25, saturation: 0.15, warmth: 0.06 },
} as const;

export type ProductCutoutGrade = {
  luminance: { band: readonly [number, number] };
  warmth: { band: readonly [number, number] };
  saturation: { band: readonly [number, number] };
};

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
