/**
 * Redrawing the menu contact sheet.
 *
 * Extracted from `normalize-menu-images.ts` so that file could take a
 * `--tenant` path-traversal guard without its line-length entry going up. The
 * ledger in tests/consistency is meant to shrink, so a guard is paid for by a
 * split rather than by raising the number.
 *
 * The four values this used to close over are parameters now, which is the
 * reason the seam is here: laying out a grid of thumbnails needs a directory,
 * a destination and a title, and nothing else about a tenant.
 */
import { join } from 'node:path';

import { MENU_IMAGE_SPEC } from '@platform/ui/src/menu-image';

/** SVG labels are drawn from item slugs, so the five XML entities are escaped. */
const escapeXml = (value: string) => value
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&apos;');

export type ContactSheetTarget = {
  readonly menuDir: string;
  readonly contactSheet: string;
  readonly brandName: string;
  readonly tenantSlug: string;
  readonly layout: { cell: number; columns: number; label: number; pad: number; header: number };
};

/**
 * Redraw the checked-in contact sheet. It is the review artefact for framing --
 * `--check` can tell you a photo is correctly exposed, but only a person
 * looking at all 61 together can tell you one of them is a picture of a wall.
 */
export async function writeContactSheet(
  sharp: (typeof import('sharp'))['default'],
  names: string[],
  sheet: ContactSheetTarget,
) {
  const { menuDir, contactSheet, brandName, tenantSlug, layout } = sheet;
  const { cell, columns, label, pad, header } = layout;
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
      input: await sharp(join(menuDir, `${name}.webp`)).resize(cell, cell).png().toBuffer(),
      left,
      top,
    });
    composites.push({
      input: Buffer.from(
        `<svg width="${cell}" height="${label}">` +
        `<text x="0" y="11" font-family="monospace" font-size="9" fill="#57483B">${escapeXml(name)}</text></svg>`,
      ),
      left,
      top: top + cell,
    });
  }
  composites.push({
    input: Buffer.from(
      `<svg width="${width}" height="${header}">` +
      `<text x="${pad}" y="22" font-family="sans-serif" font-size="16" fill="#241710">` +
      `${escapeXml(brandName ?? tenantSlug)} — menu image library (${names.length} items, ${MENU_IMAGE_SPEC.edge}px square)</text></svg>`,
    ),
    left: 0,
    top: 0,
  });

  await sharp({ create: { width, height, channels: 3, background: '#FAF5EF' } })
    .composite(composites)
    .png()
    .toFile(contactSheet);
}
