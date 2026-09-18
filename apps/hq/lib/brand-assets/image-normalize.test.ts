import assert from 'node:assert/strict';
import test from 'node:test';

import sharp from 'sharp';

import { IMAGE_INPUT_LIMITS, LOGO_EDGE, normalizeLogo, normalizeMenuPhoto } from './image-normalize';

type Rgb = { readonly r: number; readonly g: number; readonly b: number };

// A solid frame measures exactly as its one colour does, so each of these
// lands in a known place against the house band (luminance 30-72, warmth
// 30-102, saturation 0.45-0.9).
/** Luminance 62, warmth 70, saturation 0.64: in band on every axis. */
const IN_BAND: Rgb = { r: 110, g: 50, b: 40 };
/** Luminance 82: bright, but within a brightness correction of the band. */
const TOO_BRIGHT: Rgb = { r: 130, g: 70, b: 60 };
/** Luminance 209, warmth -30, saturation 0.13: beyond any allowed correction. */
const PALE_AND_COLD: Rgb = { r: 200, g: 210, b: 230 };

function solid(width: number, height: number, colour: Rgb, alpha = 1): Promise<Buffer> {
  const create = alpha < 1
    ? { width, height, channels: 4 as const, background: { ...colour, alpha } }
    : { width, height, channels: 3 as const, background: colour };
  return sharp({ create }).png().toBuffer();
}

function luminance(channels: sharp.ChannelStats[]): number {
  const [red, green, blue] = channels.map((channel) => channel.mean);
  return 0.2126 * (red ?? 0) + 0.7152 * (green ?? 0) + 0.0722 * (blue ?? 0);
}

test('a photograph in the house band is squared, sized and stored without a grade', async () => {
  const photo = await normalizeMenuPhoto(await solid(1_200, 1_600, IN_BAND));
  const metadata = await sharp(photo.bytes).metadata();
  assert.equal(metadata.format, 'webp');
  assert.equal(metadata.width, 900);
  assert.equal(metadata.height, 900);
  assert.equal(photo.edge, 900);
  assert.equal(photo.sourceEdge, 1_200);
  assert.ok(Math.abs(photo.grade.measured.luminance - 62) < 1, String(photo.grade.measured.luminance));
  assert.ok(Math.abs(photo.grade.measured.warmth - 70) < 1, String(photo.grade.measured.warmth));
  assert.deepEqual(photo.grade.correction, { brightness: 1, saturation: 1, warmth: 0 });
  assert.deepEqual(photo.grade.beyondGrade, []);
  assert.deepEqual(photo.flags, []);
});

test('a photograph near the band is pulled only as far as its nearest edge', async () => {
  const photo = await normalizeMenuPhoto(await solid(1_000, 1_000, TOO_BRIGHT));
  assert.deepEqual(photo.grade.beyondGrade, []);
  assert.ok(photo.grade.correction.brightness > 0.8 && photo.grade.correction.brightness < 1, String(photo.grade.correction.brightness));
  assert.equal(photo.grade.correction.saturation, 1);
  assert.equal(photo.grade.correction.warmth, 0);
  assert.deepEqual(photo.flags, []);
  assert.ok(luminance((await sharp(photo.bytes).stats()).channels) < 80, 'the stored frame is darker than the source');
});

test('a photograph beyond the grade is kept ungraded and flagged for a reviewer', async () => {
  const photo = await normalizeMenuPhoto(await solid(1_000, 1_000, PALE_AND_COLD));
  assert.deepEqual(photo.flags, ['off_band']);
  assert.deepEqual(photo.grade.correction, { brightness: 1, saturation: 1, warmth: 0 });
  assert.deepEqual([...photo.grade.beyondGrade].sort(), ['luminance', 'saturation', 'warmth']);
  assert.ok(luminance((await sharp(photo.bytes).stats()).channels) > 180, 'nothing was pushed toward neon');
});

test('a small or transparent source is flagged, not refused', async () => {
  const small = await normalizeMenuPhoto(await solid(300, 400, IN_BAND));
  assert.equal(small.sourceEdge, 300);
  assert.ok(small.flags.includes('upscaled'));
  assert.equal((await sharp(small.bytes).metadata()).width, 900);
  const cutout = await normalizeMenuPhoto(await solid(1_000, 1_000, IN_BAND, 0.5));
  assert.ok(cutout.flags.includes('had_transparency'));
  assert.equal((await sharp(cutout.bytes).metadata()).hasAlpha, false);
});

test('a very large source is bounded before any work, and a pixel bomb or junk is refused', async () => {
  const large = await normalizeMenuPhoto(await solid(3_000, 2_000, IN_BAND));
  assert.ok(large.sourceEdge <= IMAGE_INPUT_LIMITS.workingEdge && large.sourceEdge >= 1_360, String(large.sourceEdge));
  await assert.rejects(normalizeMenuPhoto(await solid(200, 200, IN_BAND), { limitInputPixels: 10_000 }), /pixel limit/i);
  await assert.rejects(normalizeLogo(await solid(200, 200, IN_BAND), { limitInputPixels: 10_000 }), /pixel limit/i);
  await assert.rejects(normalizeMenuPhoto(Buffer.from('not an image at all')));
});

test('a logo is fitted whole inside a transparent square, never cropped', async () => {
  const wide = await solid(1_000, 250, { r: 122, g: 62, b: 29 });
  const logo = await normalizeLogo(wide);
  assert.equal(logo.edge, LOGO_EDGE);
  assert.deepEqual(logo.flags, []);
  const { data, info } = await sharp(logo.bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  assert.equal(info.width, LOGO_EDGE);
  assert.equal(info.height, LOGO_EDGE);
  assert.equal(data[3], 0, 'the band above a wide logo is transparent');
  const centre = ((LOGO_EDGE / 2) * LOGO_EDGE + LOGO_EDGE / 2) * 4;
  assert.equal(data[centre + 3], 255, 'the logo itself stays opaque');
  assert.equal(data[centre], 122, 'and keeps its exact colour: logos are stored lossless');
  assert.deepEqual((await normalizeLogo(await solid(64, 64, IN_BAND))).flags, ['small_source']);
});
