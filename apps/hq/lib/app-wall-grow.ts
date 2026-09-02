import { frameOfKey } from '@/lib/app-previews';

import { boxesOverlap, boxOf, constrain, heightOf, maxWidthFor, type AppPreviewTile, type WallBounds } from './app-wall-geometry';
import { reflowWithContacts } from './app-wall-reflow';

/** A grow round that moves nothing by more than this many cells is finished. */
export const GROW_EPSILON = .25;
export const GROW_ROUNDS = 6;
const FREE_STEPS = 8;
const PUSH_STEPS = 4;
/** A fill attempt may not search as hard as a gesture: it runs hundreds of times per fit. */
const FILL_BUDGET = 12;

/** Where a growing frame keeps a fixed point: its centre, or one of its corners, so it can grow toward free space. */
const ANCHORS: readonly (readonly [number, number])[] = [[.5, .5], [0, 0], [1, 0], [0, 1], [1, 1]];

function expandFrom(tile: AppPreviewTile, width: number, anchor: readonly [number, number], bounds: WallBounds): AppPreviewTile {
  const before = { width: tile.width, height: heightOf(tile) };
  const after = heightOf({ ...tile, width });
  return constrain({ ...tile, width, x: tile.x + (before.width - width) * anchor[0], y: tile.y + (before.height - after) * anchor[1] }, bounds);
}

type Span = { readonly start: number; readonly end: number; readonly centre: number };
const spans = (tile: AppPreviewTile) => ({
  x: { start: tile.x, end: tile.x + tile.width, centre: tile.x + tile.width / 2 },
  y: { start: tile.y, end: tile.y + heightOf(tile), centre: tile.y + heightOf(tile) / 2 },
});
const overlaps = (one: Span, two: Span) => one.start < two.end && two.start < one.end;

/**
 * True when no two frames have swapped places. Two frames that share a row
 * keep their left-to-right order; two that share a column keep their
 * top-to-bottom order. Frames far apart on the other axis are free to slide,
 * because a push there is not a reordering. The grow pass pushes neighbours,
 * and this is what keeps the user's arrangement theirs: it decides where
 * frames sit, the fill only decides how big.
 */
export function sameArrangement(reference: readonly AppPreviewTile[], candidate: readonly AppPreviewTile[]): boolean {
  const after = new Map(candidate.map((tile) => [tile.key, spans(tile)]));
  return reference.every((first, index) => reference.slice(index + 1).every((second) => {
    const before = [spans(first), spans(second)] as const;
    const now = [after.get(first.key), after.get(second.key)] as const;
    if (!now[0] || !now[1]) return false;
    const rowKept = !overlaps(before[0].y, before[1].y) || Math.sign(before[0].x.centre - before[1].x.centre) === Math.sign(now[0].x.centre - now[1].x.centre);
    const columnKept = !overlaps(before[0].x, before[1].x) || Math.sign(before[0].y.centre - before[1].y.centre) === Math.sign(now[0].y.centre - now[1].y.centre);
    return rowKept && columnKept;
  }));
}

/** The widest `tile` gets from `anchor` under `fits`, by bisection between its width and the ceiling. */
function widestFrom(tile: AppPreviewTile, anchor: readonly [number, number], bounds: WallBounds, steps: number, fits: (candidate: AppPreviewTile) => boolean): number {
  let low = tile.width;
  let high = maxWidthFor(frameOfKey(tile.key), tile.orientation, bounds);
  if (high <= low) return low;
  if (fits(expandFrom(tile, high, anchor, bounds))) return high;
  for (let step = 0; step < steps; step += 1) {
    const middle = (low + high) / 2;
    if (fits(expandFrom(tile, middle, anchor, bounds))) low = middle; else high = middle;
  }
  return low;
}

/**
 * The layout after `tiles[index]` has grown as far as the wall allows. Free
 * space around the frame is taken first, which is cheap; only a frame that
 * cannot grow at all then grows through the reflow, pushing neighbours into
 * free space exactly as a resize handle would, within the arrangement.
 */
function grownLayout(tiles: readonly AppPreviewTile[], index: number, bounds: WallBounds): AppPreviewTile[] {
  const tile = tiles[index];
  if (!tile) return [...tiles];
  const others = tiles.filter((_, otherIndex) => otherIndex !== index);
  const clear = (candidate: AppPreviewTile) => !others.some((other) => boxesOverlap(boxOf(candidate), boxOf(other)));
  let best: AppPreviewTile[] = [...tiles];
  let bestWidth = tile.width;
  for (const anchor of ANCHORS) {
    const width = widestFrom(tile, anchor, bounds, FREE_STEPS, clear);
    if (width > bestWidth) { bestWidth = width; best = tiles.map((entry, otherIndex) => otherIndex === index ? expandFrom(tile, width, anchor, bounds) : entry); }
  }
  if (bestWidth > tile.width + GROW_EPSILON) return best;
  for (const anchor of ANCHORS) {
    let good: AppPreviewTile[] | null = null;
    const width = widestFrom(tile, anchor, bounds, PUSH_STEPS, (candidate) => {
      const result = reflowWithContacts(tiles, tile.key, candidate, bounds, { budget: FILL_BUDGET });
      if (result.refused || !sameArrangement(tiles, result.tiles)) return false;
      good = result.tiles;
      return true;
    });
    if (good && width > bestWidth) { bestWidth = width; best = good; }
  }
  return best;
}

/** Whole cells where the neighbours allow it; a rounding that would need a push it cannot get stays fractional. */
export function snapLayout(tiles: readonly AppPreviewTile[], bounds: WallBounds): AppPreviewTile[] {
  let current = [...tiles];
  for (const tile of tiles) {
    const snapped = { ...tile, width: Math.round(tile.width), x: Math.round(tile.x), y: Math.round(tile.y) };
    const result = reflowWithContacts(current, tile.key, snapped, bounds);
    if (!result.refused) current = result.tiles;
  }
  return current;
}

/**
 * Lets frames take the free space around them, smallest first so the phone
 * is not starved by the console, until nothing grows by more than a quarter
 * cell. Hand-sized tiles keep their size; everything else fills.
 */
export function growToFill(tiles: readonly AppPreviewTile[], bounds: WallBounds): AppPreviewTile[] {
  let current = [...tiles];
  for (let round = 0; round < GROW_ROUNDS; round += 1) {
    let largestDelta = 0;
    const order = current.map((tile, index) => ({ area: tile.width * heightOf(tile), index })).sort((first, second) => first.area - second.area);
    for (const { index } of order) {
      const tile = current[index];
      if (!tile || tile.sized) continue;
      current = grownLayout(current, index, bounds);
      largestDelta = Math.max(largestDelta, (current[index]?.width ?? tile.width) - tile.width);
    }
    // Snap inside the loop, so the slack a rounding leaves is filled by the next round rather than shipped.
    current = snapLayout(current, bounds);
    if (largestDelta <= GROW_EPSILON) break;
  }
  return current;
}

