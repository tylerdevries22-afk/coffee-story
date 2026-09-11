import { join } from 'node:path';

import { PRODUCT_CUTOUT_SPEC } from '@platform/ui/src/product-cutout';

import { PRODUCT_EXT } from './product-cutout-config.js';

const PLATES = { light: '#FAF5EF', dark: '#241710' } as const;
const SHEET = { cell: 200, columns: 6, label: 18, pad: 14, header: 36 };

type ContactSheetTarget = {
  products: string;
  contactSheet: string;
};

/** Draw every cut-out over light and dark plates for human halo review. */
export async function writeProductCutoutContactSheet(
  sharp: (typeof import('sharp'))['default'],
  names: string[],
  target: ContactSheetTarget,
): Promise<void> {
  const { cell, columns, label, pad, header } = SHEET;
  const cellW = cell;
  const cellH = Math.round(cell / PRODUCT_CUTOUT_SPEC.aspect);
  const rows = Math.ceil(names.length / columns);
  const width = columns * (cellW * 2 + pad) + pad;
  const height = header + rows * (cellH + label + pad) + pad;

  const composites: import('sharp').OverlayOptions[] = [{
    input: Buffer.from(
      `<svg width="${width}" height="${header}"><text x="${pad}" y="24" font-family="monospace" font-size="15" fill="#241710">Coffee Story — product cut-outs (${names.length} items, ${PRODUCT_CUTOUT_SPEC.width}x${PRODUCT_CUTOUT_SPEC.height}, light plate / dark plate)</text></svg>`,
    ),
    left: 0,
    top: 0,
  }];

  for (let i = 0; i < names.length; i++) {
    const name = names[i] as string;
    const col = i % columns;
    const row = Math.floor(i / columns);
    const x = pad + col * (cellW * 2 + pad);
    const y = header + row * (cellH + label + pad);
    const cut = await sharp(join(target.products, `${name}${PRODUCT_EXT}`))
      .resize(cellW, cellH).png().toBuffer();

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

  await sharp({ create: { width, height, channels: 4, background: '#FFFFFF' } })
    .composite(composites)
    .png()
    .toFile(target.contactSheet);
}
