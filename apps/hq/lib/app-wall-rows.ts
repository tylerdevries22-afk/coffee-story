import {
  CAPTION_ROWS, CHIP_ROWS, constrain, GAP, heightOf, type AppPreviewTile, type Size, type WallBounds,
} from './app-wall-geometry';

/** Stops corrupt storage or an extreme pointer coordinate from creating an unbounded document. */
export const MAX_WALL_ROWS = 360;
const MIN_ROW_HEIGHT = 12;

/** One logical row is tall enough for the largest device plus its grip, caption, and breathing room. */
export function wallRowHeight(tiles: readonly AppPreviewTile[], footprint?: Size): number {
  const tallest = Math.max(0, footprint?.height ?? 0, ...tiles.map((tile) => heightOf(tile)));
  return Math.max(MIN_ROW_HEIGHT, Math.ceil(tallest + CHIP_ROWS + CAPTION_ROWS + GAP));
}

/** Adds whole logical rows until `minimumRows` fits, preserving the existing row boundary. */
export function expandWallRows(
  bounds: WallBounds,
  tiles: readonly AppPreviewTile[],
  minimumRows: number,
  footprint?: Size,
): WallBounds {
  if (minimumRows <= bounds.rows) return bounds;
  const safeMinimum = Number.isFinite(minimumRows) ? minimumRows : MAX_WALL_ROWS;
  const step = wallRowHeight(tiles, footprint);
  const additions = Math.max(1, Math.ceil((safeMinimum - bounds.rows) / step));
  return { ...bounds, rows: Math.min(MAX_WALL_ROWS, bounds.rows + additions * step) };
}

/** The canvas needed for the requested placement, measured against a safely bounded preview canvas. */
export function rowsForPlacement(
  bounds: WallBounds,
  tiles: readonly AppPreviewTile[],
  candidate: AppPreviewTile,
  footprint?: Size,
): WallBounds {
  const previewBounds = { ...bounds, rows: MAX_WALL_ROWS };
  const preview = constrain(candidate, previewBounds, footprint);
  const bottom = preview.y + (footprint?.height ?? heightOf(preview)) + CAPTION_ROWS;
  return expandWallRows(bounds, tiles, bottom, footprint);
}

export function addWallRow(bounds: WallBounds, tiles: readonly AppPreviewTile[], footprint?: Size): WallBounds {
  return expandWallRows(bounds, tiles, bounds.rows + 1, footprint);
}
