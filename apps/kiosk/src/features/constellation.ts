/**
 * Laying circles out on the first screen.
 *
 * The reference for this pattern is a scatter of circles at different sizes,
 * which reads as arranged rather than tabulated -- a menu board, not a
 * spreadsheet. Doing that by hand-tuning coordinates would make every menu
 * change a design task, and a tenant with five categories would get a layout
 * built for seven.
 *
 * So it is computed: sizes come from emphasis, circles flow into rows, and
 * alternating rows are nudged vertically to break the grid. Deterministic on
 * purpose -- no `Math.random`, because a layout that moves on every render is
 * a layout that fights the entrance animation.
 *
 * Pure, so the properties that actually matter (nothing overlaps, nothing
 * leaves the screen) are tested rather than eyeballed.
 */
import type { KioskNodeEmphasis } from '@platform/domain';

export type ConstellationItem = { id: string; emphasis: KioskNodeEmphasis };

export type PlacedCircle = {
  id: string;
  /** Centre, in points from the top-left of the canvas. */
  x: number;
  y: number;
  /** Diameter. */
  size: number;
  /** Reading order, which is also the entrance stagger order. */
  index: number;
};

export type Canvas = { width: number; height: number };

/**
 * Diameters, matching the circular frames in `@platform/ui`'s menu-image
 * contract so the photograph and its ring are the same size by construction.
 */
export const CIRCLE_SIZE: Record<KioskNodeEmphasis, number> = {
  hero: 300,
  standard: 200,
  minor: 132,
};

/** Room for the label under each circle, plus breathing space between them. */
const LABEL_BAND = 64;
const GAP = 28;

export function layoutConstellation(
  items: readonly ConstellationItem[],
  canvas: Canvas,
): PlacedCircle[] {
  if (items.length === 0) return [];
  const sized = items.map((item, index) => ({
    ...item,
    index,
    size: CIRCLE_SIZE[item.emphasis] ?? CIRCLE_SIZE.standard,
  }));

  // Rows are filled greedily in the tenant's own order, so the hero tile stays
  // first and the reading order the config expresses survives the layout.
  const rows: (typeof sized)[] = [];
  let row: typeof sized = [];
  let rowWidth = 0;
  for (const item of sized) {
    const next = rowWidth === 0 ? item.size : rowWidth + GAP + item.size;
    if (row.length > 0 && next > canvas.width) {
      rows.push(row);
      row = [item];
      rowWidth = item.size;
    } else {
      row.push(item);
      rowWidth = next;
    }
  }
  if (row.length > 0) rows.push(row);

  const rowHeights = rows.map((entries) => Math.max(...entries.map((e) => e.size)) + LABEL_BAND);
  const stackHeight = rowHeights.reduce((total, height) => total + height, 0) + GAP * (rows.length - 1);
  let cursorY = Math.max(0, (canvas.height - stackHeight) / 2);

  const placed: PlacedCircle[] = [];
  rows.forEach((entries, rowIndex) => {
    const width = entries.reduce((total, e) => total + e.size, 0) + GAP * (entries.length - 1);
    let cursorX = Math.max(0, (canvas.width - width) / 2);
    const rowHeight = rowHeights[rowIndex] ?? 0;
    for (const entry of entries) {
      // The nudge that stops this reading as a grid. Derived from the row
      // index, so it is stable across renders; capped well inside the row's
      // own slack so it can never push a circle into its neighbour above.
      const drift = rowIndex % 2 === 0 ? 0 : Math.min(24, (rowHeight - entry.size) / 3);
      placed.push({
        id: entry.id,
        index: entry.index,
        size: entry.size,
        x: cursorX + entry.size / 2,
        y: cursorY + entry.size / 2 + drift,
      });
      cursorX += entry.size + GAP;
    }
    cursorY += rowHeight + GAP;
  });
  return placed;
}

/** Whether two placed circles touch. The property the layout must never break. */
export function overlaps(a: PlacedCircle, b: PlacedCircle): boolean {
  const distance = Math.hypot(a.x - b.x, a.y - b.y);
  return distance < (a.size + b.size) / 2;
}
