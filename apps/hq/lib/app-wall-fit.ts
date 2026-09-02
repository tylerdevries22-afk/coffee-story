import { frameOfKey } from '@/lib/app-previews';

import { growToFill } from './app-wall-grow';
import {
  boxOf, CANVAS_COLUMNS, CAPTION_ROWS, CHIP_ROWS, DEFAULT_ROWS, GAP, heightOf,
  layoutOverlaps, maxWidthFor, MIN_WIDTH, type AppPreviewTile, type WallBounds,
} from './app-wall-geometry';
import { openSlotNear } from './app-wall-reflow';

export { growToFill, sameArrangement } from './app-wall-grow';

export type WallLayout = { readonly bounds: WallBounds; readonly tiles: readonly AppPreviewTile[]; readonly rowFloor?: number };
export type FitMode = 'fitted' | 'stacked';
export type FitResult = { readonly tiles: AppPreviewTile[]; readonly scale: number; readonly mode: FitMode };

const SHRINK_STEP = .92;
const SHRINK_RETRIES = 6;

/** Square cells: sixty columns fixed, rows follow the canvas shape. */
export function boundsFor(width: number, height: number): WallBounds {
  const rows = width > 0 && height > 0 ? CANVAS_COLUMNS * height / width : DEFAULT_ROWS;
  return { columns: CANVAS_COLUMNS, rows };
}

export function cellSize(width: number): number {
  return width / CANVAS_COLUMNS;
}

export function boundsMatch(first: WallBounds, second: WallBounds): boolean {
  return first.columns === second.columns && Math.abs(first.rows - second.rows) < 1;
}

export function layoutExtent(tiles: readonly AppPreviewTile[]): WallBounds {
  return {
    columns: Math.max(1, ...tiles.map((tile) => tile.x + tile.width)),
    rows: Math.max(1, ...tiles.map((tile) => tile.y + heightOf(tile) + CAPTION_ROWS)),
  };
}

/**
 * Positions stretch to the new shape while sizes scale uniformly, so the
 * arrangement keeps its relationships and its relative sizes but spreads
 * across the whole wall instead of huddling in one corner of it.
 */
export function spreadLayout(tiles: readonly AppPreviewTile[], from: WallBounds, to: WallBounds, scale: number): AppPreviewTile[] {
  const sx = to.columns / from.columns;
  const sy = to.rows / from.rows;
  return tiles.map((tile) => {
    const height = heightOf(tile);
    const width = Math.max(MIN_WIDTH[frameOfKey(tile.key)], tile.width * scale);
    const grown = height * (width / tile.width);
    return { ...tile, width, x: tile.x * sx + (tile.width * sx - width) / 2, y: tile.y * sy + (height * sy - grown) / 2 };
  });
}

function readingOrder(first: AppPreviewTile, second: AppPreviewTile): number {
  return Math.round(first.y) - Math.round(second.y) || Math.round(first.x) - Math.round(second.x) || first.key.localeCompare(second.key);
}

/** Places tiles in reading order, each in the nearest free slot, or null when one cannot be placed. */
export function packLayout(tiles: readonly AppPreviewTile[], bounds: WallBounds): AppPreviewTile[] | null {
  const placed: AppPreviewTile[] = [];
  for (const tile of [...tiles].sort(readingOrder)) {
    const slot = openSlotNear(tile, placed.map((other) => boxOf(other)), bounds);
    if (!slot) return null;
    placed.push(slot);
  }
  return tiles.map((tile) => placed.find((other) => other.key === tile.key) ?? tile);
}

/** Pack, then fill: what a committed layout becomes before it is stored as the new master. */
export function fillLayout(tiles: readonly AppPreviewTile[], bounds: WallBounds): AppPreviewTile[] | null {
  const packed = packLayout(tiles, bounds);
  return packed ? growToFill(packed, bounds) : null;

}

/** One reading-order column, for a window too narrow or short to hold the wall. */
export function stackLayout(tiles: readonly AppPreviewTile[], bounds: WallBounds): AppPreviewTile[] {
  let y = CHIP_ROWS;
  return [...tiles].sort(readingOrder).map((tile) => {
    const width = Math.min(bounds.columns, tile.width);
    const placed = { ...tile, width, x: (bounds.columns - width) / 2, y };
    y += heightOf(placed) + CHIP_ROWS + CAPTION_ROWS + GAP;
    return placed;
  });
}

/**
 * The displayed layout for a master authored elsewhere. Identity when the
 * bounds still hold it, so returning to the authored window restores the
 * authored wall exactly; otherwise spread, pack, and fill.
 */
export function fitLayout(master: WallLayout, bounds: WallBounds): FitResult {
  if (boundsMatch(master.bounds, bounds) && !layoutOverlaps(master.tiles)) return { tiles: [...master.tiles], scale: 1, mode: 'fitted' };
  // A canvas too short for any frame's legible minimum is not a wall; it is a list.
  const illegible = master.tiles.some((tile) => maxWidthFor(frameOfKey(tile.key), tile.orientation, bounds) < MIN_WIDTH[frameOfKey(tile.key)]);
  if (illegible) return { tiles: stackLayout(master.tiles, bounds), scale: 1, mode: 'stacked' };
  const extent = layoutExtent(master.tiles);
  let scale = Math.min(bounds.columns / extent.columns, bounds.rows / extent.rows);
  for (let attempt = 0; attempt <= SHRINK_RETRIES; attempt += 1) {
    const packed = packLayout(spreadLayout(master.tiles, extent, bounds, scale), bounds);
    if (packed) return { tiles: growToFill(packed, bounds), scale, mode: 'fitted' };
    scale *= SHRINK_STEP;
  }
  return { tiles: stackLayout(master.tiles, bounds), scale: 1, mode: 'stacked' };
}
