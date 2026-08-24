/**
 * Product cut-out normaliser: `pnpm normalize-product-cutouts` (`--check` for CI).
 *
 * A sibling of `normalize-menu-images.ts`, not a flag on it. Every substantive
 * line of that script would need a branch for alpha -- the square centre-crop,
 * the whole-frame measurement, the grade bands, the encoder options, the
 * contact sheet -- and a branched normaliser is one where a future edit to the
 * photograph path silently changes the cut-out path.
 *
 * The directory split does more work than any assertion could. Masters live in
 * `tenants/<slug>/assets/products/` and the seated results in
 * `apps/customer/assets/products/`, neither of which the photograph
 * normaliser's readdir filter can see. A cut-out that wandered into
 * `assets/menu/` would be centre-cropped square, measured against a
 * café-interior grade band and re-encoded without its alpha -- and would still
 * look plausible in a diff. `normalize-menu-images.ts` now refuses any file
 * carrying transparency for exactly that reason.
 *
 * What this does, per asset:
 *
 *   1. **Seat, don't frame.** Trim to the exact alpha bounding box, scale so
 *      the subject's *height* is `seat.glassHeight` of the canvas, and stand it
 *      on `seat.baseline`. Scaling by height rather than by bounding-box fit is
 *      the whole point: a wide drink and a narrow one then share a rim line,
 *      and a shelf of six does not stagger.
 *   2. **Measure what is visible.** Alpha-weighted means over opaque pixels
 *      only. `sharp`'s `.stats()` returns four channels on RGBA and its means
 *      cover every invisible pixel, so the photograph script's measurement
 *      would describe a region that never reaches a screen.
 *   3. **Bleed, then zero.** sharp preserves the RGB beneath `alpha = 0`, so
 *      the invisible region is real data that affects nothing visually and
 *      everything measurably. The edge colour is bled outward so no client-side
 *      sampler pulls a fringe in off the rim, and everything beyond the bleed
 *      is zeroed so the file is byte-reproducible and the manifest hash means
 *      something.
 *   4. **Refuse rather than clamp**, inherited from the photograph contract.
 *      Geometry and matte faults can never be graded away, so they refuse the
 *      asset outright.
 *
 * The contact sheet draws every cut-out **twice, over a light plate and a dark
 * plate**. That is the only way a person sees a light matte halo, and it is
 * what the review artefact exists for.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  PRODUCT_CUTOUT_SPEC,
  isCutoutNoop,
  productCutoutSeat,
  productCutoutVerdict,
  type ProductCutoutCorrection,
  type ProductCutoutFault,
  type ProductCutoutGeometry,
  type ProductCutoutMatte,
  type ProductCutoutMeasurement,
} from '@platform/ui/src/product-cutout';

/** One extension, one stem helper -- the photograph script has five literals. */
const EXT = '.webp';
const MASTER_EXT = '.png';

/**
 * Source and output are different directories, unlike the photograph script
 * which edits `assets/menu/` in place.
 *
 * Two reasons, and the second is the one that matters. A cut-out master is a
 * 3-7 MB RGBA PNG and there are one per drink per tenant; they have no business
 * inside an app bundle. And a tenant's own artwork belongs beside its
 * `brand.json` and `menu.csv`, so adding a franchise is dropping files in one
 * folder and running two commands -- not editing anything under `apps/`.
 */
const tenantArg = process.argv.indexOf('--tenant');
const TENANT = tenantArg >= 0 ? (process.argv[tenantArg + 1] ?? 'coffee-story') : (process.env.TENANT ?? 'coffee-story');

/**
 * Masters and seated results both live with the tenant, distinguished by
 * extension: `<slug>.png` in, `<slug>.webp` out.
 *
 * Everything a brand owns is in one folder beside its `brand.json`, and
 * `pnpm onboard --apply` is what decides whose artwork the app ships. The first
 * cut had this script write straight into `apps/customer/`, which meant
 * normalising a second tenant silently overwrote the first tenant's shelf --
 * caught by running onboarding end to end rather than by reading the code.
 */
const PRODUCTS = join(process.cwd(), 'tenants', TENANT, 'assets/products');
const SOURCES = PRODUCTS;
const MANIFEST = join(PRODUCTS, '.cutouts.json');
// One level up, not inside `products/`: written into the masters folder it
// matched the `.png` master filter on the next run and the script tried to seat
// its own review artefact.
const CONTACT_SHEET = join(process.cwd(), 'tenants', TENANT, 'assets/product-cutouts-contact-sheet.png');

/** The two grounds a cut-out has to survive: the app's warm paper, and ink. */
const PLATES = { light: '#FAF5EF', dark: '#241710' } as const;
const SHEET = { cell: 200, columns: 6, label: 18, pad: 14, header: 36 };

const check = process.argv.includes('--check');

type ManifestEntry = {
  /** sha256 of the normalised bytes this script last wrote. */
  hash: string;
  measured: ProductCutoutMeasurement;
  geometry: ProductCutoutGeometry;
  matte: ProductCutoutMatte;
  correction: ProductCutoutCorrection;
  /** Present when the render is outside what grading may fix. */
  faults?: ProductCutoutFault[];
};

const sha = (buffer: Buffer | Uint8Array) => createHash('sha256').update(buffer).digest('hex');
const round = (n: number, places = 3) => Number(n.toFixed(places));
const stem = (file: string) => file.replace(/\.png$/, '');

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
function carriesAlpha(bytes: Buffer): boolean {
  return bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(12, 16).toString('ascii') === 'VP8X';
}

type Raw = { data: Buffer; width: number; height: number };

async function readRaw(sharp: (typeof import('sharp'))['default'], input: Buffer): Promise<Raw> {
  const { data, info } = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

/** The exact alpha bounding box, in pixels. */
function alphaBox(raw: Raw): { left: number; top: number; width: number; height: number } {
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
function measureCutout(raw: Raw): ProductCutoutMeasurement {
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

/**
 * The failures background removal produces, which no colour band can see.
 *
 * `subjectMass` is a flood fill from the largest opaque seed: leftover confetti
 * from the source background shows up as alpha mass outside it. `softEdge` is
 * the share of non-transparent pixels that are partial -- a hard-thresholded
 * mask lands near zero, and it reads jagged at 3x where nobody catches it at
 * thumbnail size.
 */
function measureMatte(raw: Raw): ProductCutoutMatte {
  const { width, height, data } = raw;
  const alphaAt = (i: number) => data[i * 4 + 3] ?? 0;

  let partial = 0;
  let opaque = 0;
  let totalMass = 0;
  let seed = -1;
  for (let i = 0; i < width * height; i++) {
    const a = alphaAt(i);
    if (a === 0) continue;
    totalMass += a;
    if (a === 255) {
      opaque++;
      if (seed < 0) seed = i;
    } else {
      partial++;
    }
  }

  // Flood fill the connected region the subject occupies.
  let connectedMass = 0;
  if (seed >= 0) {
    const seen = new Uint8Array(width * height);
    const stack = [seed];
    seen[seed] = 1;
    while (stack.length > 0) {
      const i = stack.pop() as number;
      connectedMass += alphaAt(i);
      const x = i % width;
      const y = (i - x) / width;
      const neighbours = [
        x > 0 ? i - 1 : -1,
        x < width - 1 ? i + 1 : -1,
        y > 0 ? i - width : -1,
        y < height - 1 ? i + width : -1,
      ];
      for (const n of neighbours) {
        if (n < 0 || seen[n] === 1 || alphaAt(n) === 0) continue;
        seen[n] = 1;
        stack.push(n);
      }
    }
  }

  // The rim is the partially transparent shell; the inner sample is the opaque
  // body. A light matte left behind reads as a rim much brighter than the body.
  let rim = 0;
  let rimN = 0;
  let inner = 0;
  let innerN = 0;
  for (let i = 0; i < width * height; i++) {
    const a = alphaAt(i);
    if (a === 0) continue;
    const lum =
      0.2126 * (data[i * 4] ?? 0) + 0.7152 * (data[i * 4 + 1] ?? 0) + 0.0722 * (data[i * 4 + 2] ?? 0);
    if (a === 255) {
      inner += lum;
      innerN++;
    } else if (a < 128) {
      // Only the outer half of the shell: the inner half is the glass wall,
      // which is legitimately semi-transparent and legitimately bright.
      rim += lum;
      rimN++;
    }
  }

  return {
    subjectMass: round(totalMass === 0 ? 0 : connectedMass / totalMass, 4),
    softEdge: round(partial + opaque === 0 ? 0 : partial / (partial + opaque), 4),
    rimLuminance: round(rimN === 0 ? 0 : rim / rimN, 1),
    innerLuminance: round(innerN === 0 ? 0 : inner / innerN, 1),
  };
}

/**
 * Bleed the edge colour outward, then zero everything beyond it.
 *
 * A nearest-opaque dilation of RGB only -- alpha is never touched. Without it a
 * bilinear sampler on the client mixes whatever the removal tool happened to
 * leave under the transparency into the rim; with it, the file is also
 * deterministic, which is what makes the manifest hash a real gate.
 */
function bleedUnderAlpha(raw: Raw, radius: number): Buffer {
  const { width, height, data } = raw;
  const out = Buffer.from(data);
  let frontier: number[] = [];
  const filled = new Uint8Array(width * height);

  for (let i = 0; i < width * height; i++) {
    if ((data[i * 4 + 3] ?? 0) > 0) {
      filled[i] = 1;
      frontier.push(i);
    } else {
      out[i * 4] = 0;
      out[i * 4 + 1] = 0;
      out[i * 4 + 2] = 0;
    }
  }

  for (let step = 0; step < radius; step++) {
    const next: number[] = [];
    for (const i of frontier) {
      const x = i % width;
      const y = (i - x) / width;
      const neighbours = [
        x > 0 ? i - 1 : -1,
        x < width - 1 ? i + 1 : -1,
        y > 0 ? i - width : -1,
        y < height - 1 ? i + width : -1,
      ];
      for (const n of neighbours) {
        if (n < 0 || filled[n] === 1) continue;
        filled[n] = 1;
        out[n * 4] = out[i * 4] ?? 0;
        out[n * 4 + 1] = out[i * 4 + 1] ?? 0;
        out[n * 4 + 2] = out[i * 4 + 2] ?? 0;
        next.push(n);
      }
    }
    frontier = next;
    if (frontier.length === 0) break;
  }

  return out;
}

/**
 * The review artefact. `--check` can tell you a cut-out is correctly seated;
 * only a person looking at all of them over both plates can tell you one has a
 * pale halo where the removal tool gave up on the condensation.
 */
async function writeContactSheet(sharp: (typeof import('sharp'))['default'], names: string[]): Promise<void> {
  const { cell, columns, label, pad, header } = SHEET;
  const cellW = cell;
  const cellH = Math.round(cell / PRODUCT_CUTOUT_SPEC.aspect);
  const rows = Math.ceil(names.length / columns);
  const width = columns * (cellW * 2 + pad) + pad;
  const height = header + rows * (cellH + label + pad) + pad;

  const composites: import('sharp').OverlayOptions[] = [];
  composites.push({
    input: Buffer.from(
      `<svg width="${width}" height="${header}"><text x="${pad}" y="24" font-family="monospace" font-size="15" fill="#241710">Coffee Story — product cut-outs (${names.length} items, ${PRODUCT_CUTOUT_SPEC.width}x${PRODUCT_CUTOUT_SPEC.height}, light plate / dark plate)</text></svg>`,
    ),
    left: 0,
    top: 0,
  });

  for (let i = 0; i < names.length; i++) {
    const name = names[i] as string;
    const col = i % columns;
    const row = Math.floor(i / columns);
    const x = pad + col * (cellW * 2 + pad);
    const y = header + row * (cellH + label + pad);
    const cut = await sharp(join(PRODUCTS, `${name}${EXT}`)).resize(cellW, cellH).png().toBuffer();

    for (const [index, plate] of [PLATES.light, PLATES.dark].entries()) {
      composites.push({
        input: await sharp({ create: { width: cellW, height: cellH, channels: 4, background: plate } })
          .png()
          .toBuffer(),
        left: x + index * cellW,
        top: y,
      });
      composites.push({ input: cut, left: x + index * cellW, top: y });
    }

    composites.push({
      input: Buffer.from(
        `<svg width="${cellW * 2}" height="${label}"><text x="0" y="13" font-family="monospace" font-size="11" fill="#6B5B4E">${name}</text></svg>`,
      ),
      left: x,
      top: y + cellH + 2,
    });
  }

  // A four-channel canvas: a three-channel one would flatten every cut-out onto
  // cream and the sheet could no longer show the thing it exists to show.
  await sharp({ create: { width, height, channels: 4, background: '#FFFFFF' } })
    .composite(composites)
    .png()
    .toFile(CONTACT_SHEET);
}

async function run() {
  const sharp = (await import('sharp')).default;
  const { width: canvasW, height: canvasH, quality, alphaQuality, effort, matte: limits } = PRODUCT_CUTOUT_SPEC;

  if (!existsSync(SOURCES)) {
    console.error(`No cut-out masters at ${SOURCES}`);
    console.error('Drop the alpha masters there, or pass --tenant <slug>.');
    process.exit(1);
  }

  const manifest: Record<string, ManifestEntry> = existsSync(MANIFEST)
    ? (JSON.parse(readFileSync(MANIFEST, 'utf8')) as Record<string, ManifestEntry>)
    : {};

  // Masters only. The seated `.webp` beside them is this script's own output,
  // and re-seating an already-seated asset would compound the resize.
  const files = readdirSync(SOURCES).filter((f) => f.endsWith(MASTER_EXT)).sort();
  if (files.length === 0) {
    console.error(`No cut-outs in ${SOURCES}`);
    process.exit(1);
  }

  const drifted: string[] = [];
  const graded: string[] = [];
  const refused: [string, ProductCutoutFault[]][] = [];
  let skipped = 0;

  for (const file of files) {
    const name = stem(file);
    const path = join(SOURCES, file);
    const target = join(PRODUCTS, `${name}${EXT}`);
    const current = readFileSync(path);

    // Skip on the *output's* hash, not the source's: that is what makes
    // `--check` a real gate. It re-derives from the master and fails if the
    // committed asset is not byte-identical to what the master produces now.
    const cached = manifest[name];
    if (cached?.hash !== undefined && existsSync(target) && cached.hash === sha(readFileSync(target))) {
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
      hash: sha(bytes),
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

  const reportRefused = () => {
    if (refused.length === 0) return;
    console.log(`\n${refused.length} cut-out(s) are outside what the pipeline may fix, and need regenerating:`);
    for (const [name, faults] of refused) console.log(`  ${name} (${faults.join(', ')})`);
    console.log('See docs/PRODUCT-CUTOUTS.md for the locked template that produced the set.');
  };

  if (check) {
    if (drifted.length > 0) {
      console.error(`${drifted.length} product cut-out(s) do not match their master:\n  ${drifted.join('\n  ')}`);
      console.error('\nRun `pnpm normalize-product-cutouts` and commit the result.');
      process.exit(1);
    }
    console.log(`All ${files.length} product cut-outs match the spec.`);
    reportRefused();
    return;
  }

  writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
  await writeContactSheet(sharp, Object.keys(manifest).sort());
  console.log(
    `\nSeated ${files.length - skipped} cut-out(s) at ${canvasW}x${canvasH}` +
      `${graded.length > 0 ? `, graded ${graded.length}: ${graded.join(', ')}` : ''}` +
      `${skipped > 0 ? `; ${skipped} already current` : ''}.`,
  );
  reportRefused();
}

run().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
