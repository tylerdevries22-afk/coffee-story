import sharp, { type Sharp } from 'sharp';

import {
  MENU_IMAGE_SPEC, MENU_MEASURE_SAMPLE, isNoop, measureMenuPixels, menuImageCorrection, menuImageCropWindow,
  menuImageWarmthMatrix, type MenuImageAxis, type MenuImageCorrection, type MenuImageMeasurement,
} from '@platform/ui/src/menu-image';

/**
 * A prospect's photographs and logo, brought onto the house image contract.
 *
 * Photographs follow docs/MENU-IMAGERY.md exactly as the tenant normaliser
 * does -- square at MENU_CROP_CENTER, 900x900 WebP q82, graded toward the
 * house band only as far as the nearest edge -- using the same crop and
 * grading arithmetic from @platform/ui. The difference is what happens to a
 * photograph the grade cannot reach: a tenant's is reported for reshooting;
 * a prospect's is kept, ungraded, and flagged `off_band`, so a reviewer sees
 * it before it ships in a demo rather than it being silently pushed to neon.
 *
 * Logos are not photographs: never cropped, never graded, fitted inside a
 * transparent 512 square and stored lossless, because a wordmark's edges are
 * the whole logo. Every decode caps the input's pixel count, because the
 * bytes are a stranger's and a small file can declare an enormous canvas.
 */
export const IMAGE_INPUT_LIMITS = { limitInputPixels: 40_000_000, workingEdge: 2_048 } as const;
export const LOGO_EDGE = 512;

export type PhotoFlag = 'off_band' | 'upscaled' | 'had_transparency';
export type LogoFlag = 'small_source';

export type PhotoGrade = {
  readonly measured: MenuImageMeasurement;
  readonly correction: MenuImageCorrection;
  /** Axes the grade could not reach; non-empty means the photo shipped ungraded. */
  readonly beyondGrade: readonly MenuImageAxis[];
};

export type NormalizedPhoto = {
  readonly bytes: Buffer;
  readonly edge: number;
  readonly sourceEdge: number;
  readonly grade: PhotoGrade;
  readonly flags: readonly PhotoFlag[];
};

export type NormalizedLogo = {
  readonly bytes: Buffer;
  readonly edge: number;
  readonly flags: readonly LogoFlag[];
};

type DecodeOptions = { readonly limitInputPixels?: number };

function decode(input: Buffer, options: DecodeOptions): Sharp {
  // `failOn: 'error'` refuses truncated and corrupt data; `pages: 1` reads
  // only the first frame of an animation.
  return sharp(input, {
    limitInputPixels: options.limitInputPixels ?? IMAGE_INPUT_LIMITS.limitInputPixels,
    failOn: 'error',
    pages: 1,
  });
}

/** One photograph as a graded 900x900 WebP, with its measurement and flags. */
export async function normalizeMenuPhoto(input: Buffer, options: DecodeOptions = {}): Promise<NormalizedPhoto> {
  const { edge, quality } = MENU_IMAGE_SPEC;
  const { isOpaque } = await decode(input, options).stats();
  // Bound the working copy first: everything after this is proportional to it.
  const working = await decode(input, options)
    .rotate()
    .resize({ width: IMAGE_INPUT_LIMITS.workingEdge, height: IMAGE_INPUT_LIMITS.workingEdge, fit: 'inside', withoutEnlargement: true })
    .flatten({ background: { r: 255, g: 255, b: 255 } })
    // Greyscale and CMYK sources become three sRGB channels, which is what
    // the grade is measured in.
    .toColourspace('srgb')
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width, height, channels } = working.info;
  const { left, top, side } = menuImageCropWindow(width, height);
  const square = await sharp(working.data, { raw: { width, height, channels } })
    .extract({ left, top, width: side, height: side })
    .resize(edge, edge, { fit: 'fill' })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const frame = (): Sharp => sharp(square.data, { raw: { width: edge, height: edge, channels: square.info.channels } });

  const stats = await frame().stats();
  const [red, green, blue] = stats.channels;
  if (!red || !green || !blue) throw new Error('A photograph must have three colour channels.');
  const sample = await frame().resize(MENU_MEASURE_SAMPLE, MENU_MEASURE_SAMPLE, { fit: 'fill' }).raw().toBuffer();
  const measured = measureMenuPixels({ red: red.mean, green: green.mean, blue: blue.mean }, sample);
  const { correction, beyondGrade } = menuImageCorrection(measured);

  let out = frame();
  if (!isNoop(correction)) {
    out = out.modulate({ brightness: correction.brightness, saturation: correction.saturation });
    if (correction.warmth !== 0) out = out.recomb(menuImageWarmthMatrix(correction));
  }
  const bytes = await out.webp({ quality }).toBuffer();
  const flags: PhotoFlag[] = [];
  if (beyondGrade.length > 0) flags.push('off_band');
  if (side < edge) flags.push('upscaled');
  if (!isOpaque) flags.push('had_transparency');
  return { bytes, edge, sourceEdge: side, grade: { measured, correction, beyondGrade }, flags };
}

/** A logo fitted, uncropped and ungraded, inside a transparent square. */
export async function normalizeLogo(input: Buffer, options: DecodeOptions = {}): Promise<NormalizedLogo> {
  const metadata = await decode(input, options).metadata();
  const bytes = await decode(input, options)
    .rotate()
    .ensureAlpha()
    .resize(LOGO_EDGE, LOGO_EDGE, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .webp({ lossless: true })
    .toBuffer();
  const longest = Math.max(metadata.width ?? 0, metadata.height ?? 0);
  return { bytes, edge: LOGO_EDGE, flags: longest < 128 ? ['small_source'] : [] };
}
