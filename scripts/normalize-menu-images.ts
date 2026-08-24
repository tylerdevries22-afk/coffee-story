/**
 * Menu image normaliser: `pnpm normalize-menu-images` (add `--check` for CI).
 *
 * The menu shipped 61 photographs that agreed on nothing. Subject scale varied
 * 2-3x, whole-frame luminance spanned 30-158, warmth spanned -3 to +100, and
 * the stored 600x682 portrait meant every square render site trimmed 12% off
 * the top and bottom. This brings all of them onto the one contract in
 * `@platform/ui`'s `MENU_IMAGE_SPEC`:
 *
 *   1. Square. Portrait sources are centre-cropped with a slight downward bias,
 *      because a drink sits low in frame and its saucer matters more than the
 *      ceiling. Every render site then shows the identical crop.
 *   2. One stored size (900x900 WebP), so no surface is upscaling.
 *   3. Graded into the house band -- and only when a photo is outside it, and
 *      only as far as the nearest edge. An in-band photo is copied through
 *      untouched, because a black americano is legitimately darker than a
 *      matcha and flattening the menu would destroy its variety.
 *
 * What this deliberately does NOT do is force a photograph that is far outside
 * the band. `menuImageCorrection` refuses those and names the axis; the first
 * cut of this script clamped instead, and turned washed-out phone snapshots
 * into neon. They are listed as needing a reshoot -- and no crop or grade will
 * ever help the three that are pictures of a wall, a retail shelf and a service
 * counter rather than of anything on the menu. See docs/MENU-IMAGERY.md.
 *
 * Idempotent by manifest as well as by arithmetic: `.normalized.json` records
 * the hash of what this script produced, so an unchanged file is skipped
 * outright and a newly dropped photograph misses the hash and gets normalised.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  MENU_IMAGE_SPEC,
  isNoop,
  menuImageCorrection,
  type MenuImageAxis,
  type MenuImageCorrection,
  type MenuImageMeasurement,
} from '@platform/ui/src/menu-image';

const CUSTOMER_MENU = join(process.cwd(), 'apps/customer/assets/menu');
const OPERATOR_MENU = join(process.cwd(), 'apps/operator/assets/menu');
const MANIFEST = join(CUSTOMER_MENU, '.normalized.json');
const CONTACT_SHEET = join(process.cwd(), 'apps/customer/assets-library/menu-images-contact-sheet.png');

/** Contact sheet layout. The sheet is how a human checks the one thing the
 *  grade cannot measure: whether the subject is framed like its neighbours. */
const SHEET = { cell: 150, columns: 7, label: 16, pad: 12, header: 34 };

/**
 * Where the square window sits in a portrait source. 0.5 is dead centre; the
 * subject sits below centre in the house shots, so the window is nudged down.
 */
const CROP_CENTER = 0.55;

/** Analysis resolution for the per-pixel saturation mean. */
const SAMPLE = 128;

const check = process.argv.includes('--check');

type ManifestEntry = {
  /** sha256 of the normalised bytes this script last wrote. */
  hash: string;
  measured: MenuImageMeasurement;
  correction: MenuImageCorrection;
  /** Present when the photograph is outside what grading may fix. */
  needsReshoot?: MenuImageAxis[];
};

const sha = (buffer: Buffer | Uint8Array) => createHash('sha256').update(buffer).digest('hex');
const round = (n: number, places = 3) => Number(n.toFixed(places));

/**
 * Whole-frame measurement, matching what `menuImageCorrection` expects.
 *
 * Saturation is the mean of per-pixel HSV S over a downsample -- not the
 * saturation of the mean colour, which reads a frame of vivid greens and pinks
 * as near-grey and would invite a correction that turns it neon.
 */
async function measure(image: import('sharp').Sharp): Promise<MenuImageMeasurement> {
  const { channels } = await image.clone().stats();
  const [r, g, b] = channels;
  if (!r || !g || !b) throw new Error('expected three colour channels');

  const { data } = await image
    .clone()
    .resize(SAMPLE, SAMPLE, { fit: 'fill' })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  let total = 0;
  const pixels = data.length / 3;
  for (let i = 0; i < pixels; i++) {
    const red = data[i * 3] ?? 0;
    const green = data[i * 3 + 1] ?? 0;
    const blue = data[i * 3 + 2] ?? 0;
    const max = Math.max(red, green, blue);
    const min = Math.min(red, green, blue);
    total += max === 0 ? 0 : (max - min) / max;
  }

  return {
    luminance: round(0.2126 * r.mean + 0.7152 * g.mean + 0.0722 * b.mean, 1),
    warmth: round(r.mean - b.mean, 1),
    saturation: round(total / pixels),
  };
}

/**
 * Redraw the checked-in contact sheet. It is the review artefact for framing --
 * `--check` can tell you a photo is correctly exposed, but only a person
 * looking at all 61 together can tell you one of them is a picture of a wall.
 */
async function writeContactSheet(sharp: (typeof import('sharp'))['default'], names: string[]) {
  const { cell, columns, label, pad, header } = SHEET;
  const rows = Math.ceil(names.length / columns);
  const width = columns * (cell + pad) + pad;
  const height = header + rows * (cell + label + pad) + pad;

  const composites: import('sharp').OverlayOptions[] = [];
  for (const [index, name] of names.entries()) {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const left = pad + column * (cell + pad);
    const top = header + row * (cell + label + pad);
    composites.push({
      input: await sharp(join(CUSTOMER_MENU, `${name}.webp`)).resize(cell, cell).png().toBuffer(),
      left,
      top,
    });
    composites.push({
      input: Buffer.from(
        `<svg width="${cell}" height="${label}">` +
        `<text x="0" y="11" font-family="monospace" font-size="9" fill="#57483B">${name}</text></svg>`,
      ),
      left,
      top: top + cell,
    });
  }
  composites.push({
    input: Buffer.from(
      `<svg width="${width}" height="${header}">` +
      `<text x="${pad}" y="22" font-family="sans-serif" font-size="16" fill="#241710">` +
      `Coffee Story — menu image library (${names.length} items, ${MENU_IMAGE_SPEC.edge}px square)</text></svg>`,
    ),
    left: 0,
    top: 0,
  });

  await sharp({ create: { width, height, channels: 3, background: '#FAF5EF' } })
    .composite(composites)
    .png()
    .toFile(CONTACT_SHEET);
}

async function run() {
  const sharp = (await import('sharp')).default;
  const { aspect, edge, quality } = MENU_IMAGE_SPEC;

  const manifest: Record<string, ManifestEntry> = existsSync(MANIFEST)
    ? (JSON.parse(readFileSync(MANIFEST, 'utf8')) as Record<string, ManifestEntry>)
    : {};

  const files = readdirSync(CUSTOMER_MENU).filter((f) => f.endsWith('.webp')).sort();
  if (files.length === 0) {
    console.error(`No .webp files in ${CUSTOMER_MENU}`);
    process.exit(1);
  }

  const drifted: string[] = [];
  const graded: string[] = [];
  const reshoot: [string, MenuImageAxis[]][] = [];
  let skipped = 0;

  for (const file of files) {
    const name = file.replace(/\.webp$/, '');
    const path = join(CUSTOMER_MENU, file);
    const current = readFileSync(path);

    const cached = manifest[name];
    if (cached?.hash === sha(current)) {
      skipped++;
      if (cached.needsReshoot?.length) reshoot.push([name, cached.needsReshoot]);
      continue;
    }

    // 0. A menu photograph is opaque. Product cut-outs are a different asset
    //    class with a different spec, a different grade and a different
    //    normaliser (docs/PRODUCT-CUTOUTS.md); dropped in here they would be
    //    centre-cropped square, measured against a café-interior grade band and
    //    re-encoded without their alpha -- all of which still produces a file
    //    that looks plausible in a diff.
    if (!(await sharp(current).stats()).isOpaque) {
      console.error(`${name} carries transparency, so it is not a menu photograph.`);
      console.error(`Move it to apps/customer/assets/products/ and run \`pnpm normalize-product-cutouts\`.`);
      process.exit(1);
    }

    // 1. Square. Crop the tallest centred-ish window the source allows.
    const meta = await sharp(current).metadata();
    const { width = 0, height = 0 } = meta;
    const side = Math.min(width, Math.round(height * aspect));
    const top = Math.round(Math.min(Math.max(height * CROP_CENTER - side / 2, 0), height - side));
    const left = Math.round((width - side) / 2);

    const squared = sharp(current)
      .extract({ left, top, width: side, height: side })
      .resize(edge, edge, { fit: 'fill' });

    // 2. Grade -- measured on the pixels that actually ship, after the crop.
    const measured = await measure(squared);
    const { correction, beyondGrade } = menuImageCorrection(measured);

    let out = squared.clone();
    if (!isNoop(correction)) {
      out = out.modulate({ brightness: correction.brightness, saturation: correction.saturation });
      if (correction.warmth !== 0) {
        const red = 1 + correction.warmth;
        const blue = 1 - correction.warmth;
        out = out.recomb([[red, 0, 0], [0, 1, 0], [0, 0, blue]]);
      }
      graded.push(name);
    }
    if (beyondGrade.length > 0) reshoot.push([name, beyondGrade]);

    const bytes = await out.webp({ quality }).toBuffer();

    if (check) {
      drifted.push(name);
      continue;
    }

    writeFileSync(path, bytes);
    // The operator app carries a byte-identical copy of the menu assets.
    writeFileSync(join(OPERATOR_MENU, file), bytes);
    manifest[name] = {
      hash: sha(bytes),
      measured,
      correction,
      ...(beyondGrade.length > 0 ? { needsReshoot: beyondGrade } : {}),
    };
  }

  const reportReshoot = () => {
    if (reshoot.length === 0) return;
    console.log(`\n${reshoot.length} photograph(s) are outside what grading may fix, and need reshooting:`);
    for (const [name, axes] of reshoot) console.log(`  ${name} (${axes.join(', ')})`);
    console.log('See docs/MENU-IMAGERY.md for the house spec and the prompt that produced the set.');
  };

  if (check) {
    if (drifted.length > 0) {
      console.error(`${drifted.length} menu image(s) are not normalised:\n  ${drifted.join('\n  ')}`);
      console.error('\nRun `pnpm normalize-menu-images` and commit the result.');
      process.exit(1);
    }
    console.log(`All ${files.length} menu images match the spec.`);
    reportReshoot();
    return;
  }

  writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
  await writeContactSheet(sharp, files.map((f) => f.replace(/\.webp$/, '')));
  console.log(
    `Normalised ${files.length - skipped} image(s) to ${edge}x${edge}` +
    `${graded.length > 0 ? `, graded ${graded.length}: ${graded.join(', ')}` : ''}` +
    `${skipped > 0 ? `; ${skipped} already current` : ''}.`,
  );
  reportReshoot();
}

run().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
