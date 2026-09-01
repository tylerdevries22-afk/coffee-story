import type { AppPreviewKey } from '@/lib/app-previews';

export const CANVAS_COLUMNS = 60;
export const CANVAS_ROWS = 48;
const HEADER_ROWS = 3;
const FOOTER_ROWS = 2;
const GAP = .35;

const ASPECT: Readonly<Record<AppPreviewKey, number>> = {
  hq: 1.242, customer: .501, operator: 1.386, kiosk: 1.386, display: 1.72,
};

export type AppPreviewTile = {
  readonly key: AppPreviewKey;
  readonly width: number;
  readonly x: number;
  readonly y: number;
};

export const INITIAL_LAYOUT: Readonly<Record<AppPreviewKey, AppPreviewTile>> = {
  hq: { key: 'hq', x: 2, y: 4, width: 29 },
  display: { key: 'display', x: 33, y: 4, width: 25 },
  operator: { key: 'operator', x: 36, y: 24, width: 16 },
  kiosk: { key: 'kiosk', x: 18, y: 33, width: 16 },
  customer: { key: 'customer', x: 53, y: 32, width: 7 },
};

export function aspectOf(key: AppPreviewKey): number {
  return ASPECT[key];
}

function heightOf(tile: AppPreviewTile): number {
  return tile.width / aspectOf(tile.key);
}

function constrain(tile: AppPreviewTile): AppPreviewTile {
  const width = Math.min(CANVAS_ROWS * aspectOf(tile.key), Math.max(6, tile.width));
  const height = heightOf({ ...tile, width });
  return {
    ...tile,
    width,
    x: Math.min(CANVAS_COLUMNS - width, Math.max(0, tile.x)),
    y: Math.min(CANVAS_ROWS - height - FOOTER_ROWS, Math.max(HEADER_ROWS, tile.y)),
  };
}

export function tilesOverlap(one: AppPreviewTile, two: AppPreviewTile): boolean {
  return one.x < two.x + two.width && one.x + one.width > two.x
    && one.y - HEADER_ROWS < two.y + heightOf(two) + FOOTER_ROWS
    && one.y + heightOf(one) + FOOTER_ROWS > two.y - HEADER_ROWS;
}

function nearestOpen(candidate: AppPreviewTile, occupied: readonly AppPreviewTile[]): AppPreviewTile | null {
  const snapped = constrain(candidate);
  const fits = (tile: AppPreviewTile) => !occupied.some((other) => tilesOverlap(tile, other));
  if (fits(snapped)) return snapped;
  for (let radius = 1; radius < CANVAS_COLUMNS; radius += 1) {
    for (let y = -radius; y <= radius; y += 1) for (let x = -radius; x <= radius; x += 1) {
      if (Math.max(Math.abs(x), Math.abs(y)) !== radius) continue;
      const option = constrain({ ...snapped, x: snapped.x + x, y: snapped.y + y });
      if (fits(option)) return option;
    }
  }
  return null;
}

function pushAway(tile: AppPreviewTile, from: AppPreviewTile): AppPreviewTile {
  const tileCenterX = tile.x + tile.width / 2;
  const tileCenterY = tile.y + heightOf(tile) / 2;
  const fromCenterX = from.x + from.width / 2;
  const fromCenterY = from.y + heightOf(from) / 2;
  const overlapX = Math.min(tile.x + tile.width, from.x + from.width) - Math.max(tile.x, from.x);
  const overlapY = Math.min(tile.y + heightOf(tile) + FOOTER_ROWS, from.y + heightOf(from) + FOOTER_ROWS)
    - Math.max(tile.y - HEADER_ROWS, from.y - HEADER_ROWS);
  const horizontal = overlapX <= overlapY;
  return horizontal
    ? { ...tile, x: tileCenterX >= fromCenterX ? from.x + from.width + GAP : from.x - tile.width - GAP }
    : { ...tile, y: tileCenterY >= fromCenterY ? from.y + heightOf(from) + FOOTER_ROWS + HEADER_ROWS + GAP : from.y - heightOf(tile) - FOOTER_ROWS - HEADER_ROWS - GAP };
}

/** Places the active device continuously, repelling and spring-settling every collision chain. */
export function reflowTiles(tiles: readonly AppPreviewTile[], key: AppPreviewKey, candidate: AppPreviewTile): AppPreviewTile[] {
  const active = tiles.find((tile) => tile.key === key);
  if (!active) return [...tiles];
  const moved = constrain(candidate);
  const remaining = tiles.filter((tile) => tile.key !== key);
  const settled: AppPreviewTile[] = [moved];
  const distanceToMoved = (tile: AppPreviewTile) => Math.hypot(
    tile.x + tile.width / 2 - moved.x - moved.width / 2,
    tile.y + heightOf(tile) / 2 - moved.y - heightOf(moved) / 2,
  );
  const ordered = [...remaining].sort((first, second) => distanceToMoved(first) - distanceToMoved(second));
  for (const tile of ordered) {
    const collider = settled.find((placed) => tilesOverlap(tile, placed));
    const desired = collider ? pushAway(tile, collider) : tile;
    const placed = nearestOpen(desired, settled);
    if (!placed) return [...tiles];
    settled.push(placed);
  }
  return tiles.map((tile) => settled.find((placed) => placed.key === tile.key) ?? tile);
}
