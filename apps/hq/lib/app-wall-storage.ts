import { APP_PREVIEW_KEYS, type AppPreviewKey } from '@/lib/app-previews';

import { DEFAULT_BOUNDS, INITIAL_LAYOUT, type AppPreviewTile, type Orientation, type WallBounds } from './app-wall-geometry';
import type { WallLayout } from './app-wall-fit';
import { MAX_WALL_ROWS } from './app-wall-rows';

/** Versioned like `hq.navigation.compact.v1`, so a future shape can coexist with this one. */
export const WALL_STORAGE_KEY = 'hq.apps-wall.layout.v1';

export type PersistedWallTile = {
  readonly key: AppPreviewKey;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly orientation: Orientation;
  readonly sized: boolean;
};

export type PersistedWallV1 = {
  readonly version: 1;
  readonly bounds: WallBounds;
  readonly rowFloor?: number;
  readonly tiles: readonly PersistedWallTile[];
};

const round = (value: number) => Math.round(value * 100) / 100;
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const isOrientation = (value: unknown): value is Orientation => value === 'landscape' || value === 'portrait';

export function defaultWallLayout(keys: readonly AppPreviewKey[] = APP_PREVIEW_KEYS): WallLayout {
  return { bounds: DEFAULT_BOUNDS, tiles: keys.map((key) => INITIAL_LAYOUT[key]) };
}

export function serializeWallLayout(layout: WallLayout): string {
  const record: PersistedWallV1 = {
    version: 1,
    bounds: { columns: layout.bounds.columns, rows: round(layout.bounds.rows) },
    ...(layout.rowFloor ? { rowFloor: round(layout.rowFloor) } : {}),
    tiles: layout.tiles.map((tile) => ({ key: tile.key, x: round(tile.x), y: round(tile.y), width: round(tile.width), orientation: tile.orientation, sized: tile.sized })),
  };
  return JSON.stringify(record);
}

function parseTile(value: unknown, keys: readonly AppPreviewKey[]): AppPreviewTile | null {
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;
  const key = keys.find((candidate) => candidate === record.key);
  if (!key || !finite(record.x) || !finite(record.y) || !finite(record.width) || !isOrientation(record.orientation)) return null;
  return { key, x: record.x, y: record.y, width: record.width, orientation: record.orientation, sized: record.sized === true };
}

/**
 * Restores a stored wall, or null when the record is unusable. Bad tiles are
 * dropped one at a time rather than failing the whole record, because a user's
 * arrangement is worth keeping even when one entry was mangled; the apps a
 * record does not mention take their default place.
 */
export function parseWallLayout(raw: string | null | undefined, keys: readonly AppPreviewKey[] = APP_PREVIEW_KEYS): WallLayout | null {
  if (!raw) return null;
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return null; }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const record = parsed as Record<string, unknown>;
  if (record.version !== 1 || !Array.isArray(record.tiles)) return null;
  const bounds = record.bounds as Record<string, unknown> | undefined;
  if (!bounds || bounds.columns !== DEFAULT_BOUNDS.columns || !finite(bounds.rows) || bounds.rows <= 0 || bounds.rows > MAX_WALL_ROWS) return null;
  const rowFloor = finite(record.rowFloor) && record.rowFloor > 0 && record.rowFloor <= MAX_WALL_ROWS ? record.rowFloor : undefined;
  const seen = new Map<AppPreviewKey, AppPreviewTile>();
  for (const entry of record.tiles) {
    const tile = parseTile(entry, keys);
    if (tile && !seen.has(tile.key)) seen.set(tile.key, tile);
  }
  return { bounds: { columns: DEFAULT_BOUNDS.columns, rows: bounds.rows }, tiles: keys.map((key) => seen.get(key) ?? INITIAL_LAYOUT[key]), ...(rowFloor ? { rowFloor } : {}) };
}
