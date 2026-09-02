import { frameOfKey, type AppPreviewFrame, type AppPreviewKey } from '@/lib/app-previews';

export const CANVAS_COLUMNS = 60;
export const DEFAULT_ROWS = 48;
/** Rows the grip chip overhangs above a frame; counted in collision so a chip never sits on a neighbour. */
export const CHIP_ROWS = 1;
/** Rows reserved under a frame for its caption, for the same reason. */
export const CAPTION_ROWS = 2;
export const GAP = .35;

export type Orientation = 'landscape' | 'portrait';
export type Point = { readonly x: number; readonly y: number };
export type Size = { readonly width: number; readonly height: number };
export type WallBounds = { readonly columns: number; readonly rows: number };
export type WallLimits = { readonly minX: number; readonly maxX: number; readonly minY: number; readonly maxY: number };
export type Box = Point & Size & { readonly key: AppPreviewKey };

export type AppPreviewTile = {
  readonly key: AppPreviewKey;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly orientation: Orientation;
  /** True once the user has sized this frame by hand; the fill pass then leaves it alone. */
  readonly sized: boolean;
};

export const DEFAULT_BOUNDS: WallBounds = { columns: CANVAS_COLUMNS, rows: DEFAULT_ROWS };

/** The only aspect table: every footprint, stage and silhouette derives from it. */
export const FRAME_ASPECT: Readonly<Record<AppPreviewFrame, number>> = { computer: 1.242, phone: .501, tablet: 1.386, tv: 1.72 };
/** Below these widths (in columns) the embedded app stops being legible. */
export const MIN_WIDTH: Readonly<Record<AppPreviewFrame, number>> = { phone: 5, tablet: 9, computer: 12, tv: 12 };
/** Above these the arrangement's hierarchy inverts: a phone should never dwarf the console. */
export const MAX_WIDTH: Readonly<Record<AppPreviewFrame, number>> = { phone: 12, tablet: 30, computer: 40, tv: 40 };

export const INITIAL_LAYOUT: Readonly<Record<AppPreviewKey, AppPreviewTile>> = {
  hq: { key: 'hq', x: 2, y: 4, width: 29, orientation: 'landscape', sized: false },
  display: { key: 'display', x: 33, y: 4, width: 25, orientation: 'landscape', sized: false },
  operator: { key: 'operator', x: 36, y: 24, width: 16, orientation: 'landscape', sized: false },
  kiosk: { key: 'kiosk', x: 18, y: 33, width: 16, orientation: 'landscape', sized: false },
  customer: { key: 'customer', x: 53, y: 32, width: 7, orientation: 'landscape', sized: false },
};

export function footprintAspect(frame: AppPreviewFrame, orientation: Orientation): number {
  const aspect = FRAME_ASPECT[frame];
  return orientation === 'portrait' ? 1 / aspect : aspect;
}

export function tileAspect(tile: Pick<AppPreviewTile, 'key' | 'orientation'>): number {
  return footprintAspect(frameOfKey(tile.key), tile.orientation);
}

export function heightOf(tile: Pick<AppPreviewTile, 'key' | 'orientation' | 'width'>): number {
  return tile.width / tileAspect(tile);
}

export function footprintOf(tile: Pick<AppPreviewTile, 'key' | 'orientation' | 'width'>): Size {
  return { width: tile.width, height: heightOf(tile) };
}

/** A tile as the collision system sees it; `footprint` lets a mid-turn shape stand in for the rest shape. */
export function boxOf(tile: AppPreviewTile, footprint?: Size): Box {
  const size = footprint ?? footprintOf(tile);
  return { key: tile.key, x: tile.x, y: tile.y, width: size.width, height: size.height };
}

/** The widest a frame may be on this canvas: its own ceiling, the columns, and the rows left after chrome. */
export function maxWidthFor(frame: AppPreviewFrame, orientation: Orientation, canvas: WallBounds): number {
  const rowsForFrame = Math.max(0, canvas.rows - CHIP_ROWS - CAPTION_ROWS);
  return Math.max(0, Math.min(MAX_WIDTH[frame], canvas.columns, rowsForFrame * footprintAspect(frame, orientation)));
}

export function wallBounds(footprint: Size, canvas: WallBounds): WallLimits {
  return {
    minX: 0,
    maxX: Math.max(0, canvas.columns - footprint.width),
    minY: CHIP_ROWS,
    maxY: Math.max(CHIP_ROWS, canvas.rows - footprint.height - CAPTION_ROWS),
  };
}

export function constrain(tile: AppPreviewTile, canvas: WallBounds = DEFAULT_BOUNDS, footprint?: Size): AppPreviewTile {
  const frame = frameOfKey(tile.key);
  const ceiling = maxWidthFor(frame, tile.orientation, canvas);
  // On a canvas too short for even the legible minimum the ceiling wins:
  // an oversized frame that leaves the wall is worse than a small one.
  const width = footprint ? tile.width : Math.min(ceiling, Math.max(Math.min(MIN_WIDTH[frame], ceiling), tile.width));
  const limits = wallBounds(footprint ?? footprintOf({ ...tile, width }), canvas);
  return {
    ...tile,
    width,
    x: Math.min(limits.maxX, Math.max(limits.minX, tile.x)),
    y: Math.min(limits.maxY, Math.max(limits.minY, tile.y)),
  };
}

/**
 * The same device turned a quarter: the footprint swaps, so the frame keeps
 * its physical size instead of being fitted inside its old box (which is what
 * shrank a rotated display). Recentred so the device turns about its middle.
 */
export function rotatedTile(tile: AppPreviewTile): AppPreviewTile {
  const before = footprintOf(tile);
  const orientation: Orientation = tile.orientation === 'portrait' ? 'landscape' : 'portrait';
  return {
    ...tile,
    orientation,
    width: before.height,
    x: tile.x + before.width / 2 - before.height / 2,
    y: tile.y + before.height / 2 - before.width / 2,
  };
}

/** Interpolates two footprints; `t` may pass 1 under spring overshoot and the result stays finite. */
export function lerpFootprint(from: Size, to: Size, t: number): Size {
  return { width: from.width + (to.width - from.width) * t, height: from.height + (to.height - from.height) * t };
}

export function boxesOverlap(one: Box, two: Box): boolean {
  return one.x < two.x + two.width && one.x + one.width > two.x
    && one.y - CHIP_ROWS < two.y + two.height + CAPTION_ROWS
    && one.y + one.height + CAPTION_ROWS > two.y - CHIP_ROWS;
}

export function tilesOverlap(one: AppPreviewTile, two: AppPreviewTile): boolean {
  return boxesOverlap(boxOf(one), boxOf(two));
}

export function layoutOverlaps(tiles: readonly AppPreviewTile[]): boolean {
  return tiles.some((tile, index) => tiles.slice(index + 1).some((other) => tilesOverlap(tile, other)));
}

export function layoutsMatch(first: readonly AppPreviewTile[], second: readonly AppPreviewTile[]): boolean {
  return first.length === second.length && first.every((tile, index) => {
    const other = second[index];
    return other !== undefined && tile.key === other.key && tile.x === other.x && tile.y === other.y
      && tile.width === other.width && tile.orientation === other.orientation;
  });
}
