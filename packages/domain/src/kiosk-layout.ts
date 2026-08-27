import type { KioskNodeEmphasis } from './kiosk-flow';

/** The input needed to place a kiosk's first-screen tiles. */
export type ConstellationItem = { id: string; emphasis: KioskNodeEmphasis };

export type PlacedCircle = {
  id: string;
  /** Centre, in points from the top-left of the canvas. */
  x: number;
  y: number;
  /** Diameter. This is responsive to the measured kiosk canvas. */
  size: number;
  /** Reading order, which is also the entrance stagger order. */
  index: number;
};

export type Canvas = { width: number; height: number };

/** Baseline diameters. The layout scales these down when a canvas is compact. */
export const CIRCLE_SIZE: Record<KioskNodeEmphasis, number> = {
  hero: 300,
  standard: 200,
  minor: 132,
};

/** Room for two lines of label/caption and breathing space between rows. */
const LABEL_BAND = 74;
const GAP = 28;
const CANVAS_INSET = 24;

type SizedItem = ConstellationItem & { index: number; size: number };

/** Keep the first screen composed rather than squeezing a fifth tile beside the hero. */
function rowsFor(items: readonly SizedItem[], canvasWidth: number, gap: number): SizedItem[][] {
  const rows: SizedItem[][] = [];
  let row: SizedItem[] = [];
  let rowWidth = 0;
  const capFirstRow = items[0]?.emphasis === 'hero' && items.length > 4 ? 4 : Number.POSITIVE_INFINITY;
  for (const item of items) {
    const next = rowWidth === 0 ? item.size : rowWidth + gap + item.size;
    const rowCapReached = rows.length === 0 && row.length >= capFirstRow;
    if (row.length > 0 && (next > canvasWidth || rowCapReached)) {
      rows.push(row);
      row = [item];
      rowWidth = item.size;
    } else {
      row.push(item);
      rowWidth = next;
    }
  }
  if (row.length > 0) rows.push(row);
  return rows;
}

function dimensions(rows: readonly SizedItem[][], gap: number) {
  const widths = rows.map((row) => row.reduce((total, item) => total + item.size, 0) + gap * (row.length - 1));
  const heights = rows.map((row) => Math.max(...row.map((item) => item.size)) + LABEL_BAND);
  return {
    width: Math.max(...widths, 0),
    height: heights.reduce((total, value) => total + value, 0) + gap * Math.max(0, rows.length - 1),
    heights,
  };
}

/** Place circles deterministically and keep the full constellation inside the measured canvas. */
export function layoutConstellation(
  items: readonly ConstellationItem[],
  canvas: Canvas,
): PlacedCircle[] {
  if (items.length === 0) return [];
  const source = items.map((item, index) => ({
    ...item,
    index,
    size: CIRCLE_SIZE[item.emphasis] ?? CIRCLE_SIZE.standard,
  }));
  const availableWidth = Math.max(1, canvas.width - CANVAS_INSET);
  const availableHeight = Math.max(1, canvas.height - CANVAS_INSET);
  let scale = 1;
  let rows: SizedItem[][] = [];
  let metrics = dimensions([], GAP);

  // Reflow after each scale pass: shrinking can bring another tile onto a row,
  // and the resulting height is the value that must fit the stage.
  for (let pass = 0; pass < 5; pass += 1) {
    const gap = Math.max(14, GAP * scale);
    const sized = source.map((item) => ({ ...item, size: item.size * scale }));
    rows = rowsFor(sized, availableWidth, gap);
    metrics = dimensions(rows, gap);
    const nextScale = Math.min(scale, availableWidth / metrics.width, availableHeight / metrics.height);
    if (nextScale >= scale - 0.002) break;
    scale = Math.max(0.42, nextScale);
  }

  const gap = Math.max(14, GAP * scale);
  const rowHeights = metrics.heights;
  let cursorY = Math.max(CANVAS_INSET / 2, (canvas.height - metrics.height) / 2);
  const placed: PlacedCircle[] = [];
  rows.forEach((entries, rowIndex) => {
    const width = entries.reduce((total, entry) => total + entry.size, 0) + gap * (entries.length - 1);
    let cursorX = Math.max(CANVAS_INSET / 2, (canvas.width - width) / 2);
    const rowHeight = rowHeights[rowIndex] ?? 0;
    for (const entry of entries) {
      const drift = rowIndex % 2 === 0 ? 0 : Math.min(24 * scale, (rowHeight - entry.size) / 3);
      placed.push({
        id: entry.id,
        index: entry.index,
        size: entry.size,
        x: cursorX + entry.size / 2,
        y: cursorY + entry.size / 2 + drift,
      });
      cursorX += entry.size + gap;
    }
    cursorY += rowHeight + gap;
  });
  return placed;
}

/** Whether two placed circles touch. */
export function overlaps(a: PlacedCircle, b: PlacedCircle): boolean {
  const distance = Math.hypot(a.x - b.x, a.y - b.y);
  return distance < (a.size + b.size) / 2;
}
