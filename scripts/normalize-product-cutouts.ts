/**
 * Normalise transparent product masters into seated, graded WebP cut-outs.
 * Pixel measurement, matte cleanup, runtime paths, and contact-sheet rendering
 * live in focused modules; this file coordinates the CLI and manifest.
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { isPlatformSlug } from '@platform/schema';

import {
  PRODUCT_CUTOUT_SPEC,
  isCutoutNoop,
  productCutoutSeat,
  productCutoutVerdict,
  type ProductCutoutFault,
  type ProductCutoutGeometry,
} from '@platform/ui/src/product-cutout';

import {
  PRODUCT_EXT,
  PRODUCT_MASTER_EXT,
  hashProductCutout,
  productCutoutPaths,
  productCutoutTenant,
  productStem,
  type ProductCutoutManifestEntry,
} from './product-cutout-config.js';
import { writeProductCutoutContactSheet } from './product-cutout-contact-sheet.js';
import { bleedUnderAlpha, measureMatte } from './product-cutout-matte.js';
import { alphaBox, carriesAlpha, measureCutout, readRaw, round } from './product-cutout-raster.js';
import { reportProductCutoutFaults } from './product-cutout-report.js';

const TENANT = productCutoutTenant(process.argv, process.env.TENANT);
// Joined into a filesystem path below for reads and for two writes. onboard.ts
// validates the identical flag against the same pattern; this script must not
// be the soft way in, so `--tenant ../../elsewhere` stops here.
if (!isPlatformSlug(TENANT)) {
  console.error(`--tenant "${TENANT}" is not a kebab-case tenant slug.`);
  process.exit(1);
}
const { products: PRODUCTS, manifest: MANIFEST, contactSheet: CONTACT_SHEET } =
  productCutoutPaths(process.cwd(), TENANT);
const SOURCES = PRODUCTS;
const check = process.argv.includes('--check');

async function run() {
  const sharp = (await import('sharp')).default;
  const { width: canvasW, height: canvasH, quality, alphaQuality, effort, matte: limits } = PRODUCT_CUTOUT_SPEC;

  if (!existsSync(SOURCES)) {
    console.error(`No cut-out masters at ${SOURCES}`);
    console.error('Drop the alpha masters there, or pass --tenant <slug>.');
    process.exit(1);
  }

  const manifest: Record<string, ProductCutoutManifestEntry> = existsSync(MANIFEST)
    ? (JSON.parse(readFileSync(MANIFEST, 'utf8')) as Record<string, ProductCutoutManifestEntry>)
    : {};

  // Masters only. The seated `.webp` beside them is this script's own output,
  // and re-seating an already-seated asset would compound the resize.
  const files = readdirSync(SOURCES).filter((f) => f.endsWith(PRODUCT_MASTER_EXT)).sort();
  if (files.length === 0) {
    console.error(`No cut-outs in ${SOURCES}`);
    process.exit(1);
  }

  const drifted: string[] = [];
  const graded: string[] = [];
  const refused: [string, ProductCutoutFault[]][] = [];
  let skipped = 0;

  for (const file of files) {
    const name = productStem(file);
    const path = join(SOURCES, file);
    const target = join(PRODUCTS, `${name}${PRODUCT_EXT}`);
    const current = readFileSync(path);

    // Skip on the *output's* hash, not the source's: that is what makes
    // `--check` a real gate. It re-derives from the master and fails if the
    // committed asset is not byte-identical to what the master produces now.
    const cached = manifest[name];
    if (cached?.hash !== undefined && existsSync(target) && cached.hash === hashProductCutout(readFileSync(target))) {
      skipped++;
      if (cached.faults?.length) refused.push([name, cached.faults]);
      continue;
    }

    // 1. Seat. Trim to the subject's own alpha, scale to one glass height, and
    //    stand it on one baseline.
    const source = await readRaw(sharp, current);
    const bbox = alphaBox(source);
    const seat = productCutoutSeat(bbox);

    const seated = await sharp(current)
      .ensureAlpha()
      .extract(bbox)
      .resize(seat.targetWidth, seat.targetHeight, { fit: 'fill' })
      .extend({
        left: seat.left,
        top: seat.top,
        right: canvasW - seat.left - seat.targetWidth,
        bottom: canvasH - seat.top - seat.targetHeight,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
      .toBuffer();

    // 2. Measure what is visible, on the pixels that actually ship.
    const raw = await readRaw(sharp, seated);
    const measured = measureCutout(raw);
    const matte = measureMatte(raw);
    const box = alphaBox(raw);
    const geometry: ProductCutoutGeometry = {
      height: round(box.height / canvasH, 4),
      baseline: round((box.top + box.height) / canvasH, 4),
      centerX: round((box.left + box.width / 2) / canvasW, 4),
      width: round(box.width / canvasW, 4),
    };

    const { correction, faults } = productCutoutVerdict(measured, geometry, matte);

    // 3. Grade, then bleed. Grading first because the bleed samples the graded
    //    edge, so the invisible margin matches the rim it was taken from.
    let out = sharp(seated);
    if (!isCutoutNoop(correction)) {
      out = out.modulate({ brightness: correction.brightness, saturation: correction.saturation });
      if (correction.warmth !== 0) {
        const red = 1 + correction.warmth;
        const blue = 1 - correction.warmth;
        out = out.recomb([[red, 0, 0], [0, 1, 0], [0, 0, blue]]);
      }
      graded.push(name);
    }
    if (faults.length > 0) refused.push([name, faults]);

    const bled = bleedUnderAlpha(await readRaw(sharp, await out.toBuffer()), limits.bleedPx);
    const bytes = await sharp(bled, { raw: { width: canvasW, height: canvasH, channels: 4 } })
      .webp({ quality, alphaQuality, effort })
      .toBuffer();

    if (!carriesAlpha(bytes)) {
      console.error(`${name} encoded without an alpha channel, which defeats the entire asset class.`);
      process.exit(1);
    }

    if (check) {
      drifted.push(name);
      continue;
    }

    writeFileSync(target, bytes);
    manifest[name] = {
      hash: hashProductCutout(bytes),
      measured,
      geometry,
      matte,
      correction,
      ...(faults.length > 0 ? { faults } : {}),
    };
    console.log(
      `  ${name}: lum ${measured.luminance} warmth ${measured.warmth} sat ${measured.saturation}` +
        ` | softEdge ${matte.softEdge} mass ${matte.subjectMass} rim ${matte.rimLuminance} inner ${matte.innerLuminance}` +
        ` | ${Math.round(bytes.length / 1024)} KB`,
    );
  }

  if (check) {
    if (drifted.length > 0) {
      console.error(`${drifted.length} product cut-out(s) do not match their master:\n  ${drifted.join('\n  ')}`);
      console.error('\nRun `pnpm normalize-product-cutouts` and commit the result.');
      process.exit(1);
    }
    console.log(`All ${files.length} product cut-outs match the spec.`);
    reportProductCutoutFaults(refused);
    return;
  }

  writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
  await writeProductCutoutContactSheet(sharp, Object.keys(manifest).sort(), {
    products: PRODUCTS,
    contactSheet: CONTACT_SHEET,
  });
  console.log(
    `\nSeated ${files.length - skipped} cut-out(s) at ${canvasW}x${canvasH}` +
      `${graded.length > 0 ? `, graded ${graded.length}: ${graded.join(', ')}` : ''}` +
      `${skipped > 0 ? `; ${skipped} already current` : ''}.`,
  );
  reportProductCutoutFaults(refused);
}

run().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
