import type { AppPreviewKey } from '@/lib/app-previews';

import {
  boxesOverlap, boxOf, CAPTION_ROWS, CHIP_ROWS, constrain, DEFAULT_BOUNDS, GAP,
  type AppPreviewTile, type Box, type Size, type WallBounds,
} from './app-wall-geometry';

export type Axis = 'x' | 'y';
export type Contact = {
  readonly key: AppPreviewKey;
  readonly pushedBy: AppPreviewKey;
  readonly axis: Axis;
  readonly direction: -1 | 1;
  /** 1 for a tile the active tile pushed directly, 2 for one it pushed through that tile, and so on. */
  readonly depth: number;
};
export type ReflowResult = { readonly tiles: AppPreviewTile[]; readonly contacts: Contact[]; readonly refused: boolean };
export type ReflowOptions = { readonly footprint?: Size; /** Placement attempts allowed; a fill pass asks for fewer than a live gesture. */ readonly budget?: number };

type Push = { readonly x: number; readonly y: number; readonly axis: Axis; readonly direction: -1 | 1; readonly distance: number };

const VERTICAL_CHROME = CHIP_ROWS + CAPTION_ROWS;

/** Every way `tile` could clear `from`, nearest first: the smallest visible jump is tried before the others. */
export function pushOptions(tile: Box, from: Box): Push[] {
  const options: Push[] = [
    { axis: 'x', direction: 1, x: from.x + from.width + GAP, y: tile.y, distance: 0 },
    { axis: 'x', direction: -1, x: from.x - tile.width - GAP, y: tile.y, distance: 0 },
    { axis: 'y', direction: 1, x: tile.x, y: from.y + from.height + VERTICAL_CHROME + GAP, distance: 0 },
    { axis: 'y', direction: -1, x: tile.x, y: from.y - tile.height - VERTICAL_CHROME - GAP, distance: 0 },
  ];
  return options
    .map((option) => ({ ...option, distance: Math.hypot(option.x - tile.x, option.y - tile.y) }))
    .sort((first, second) => first.distance - second.distance);
}

/** Moves `tile` just clear of `from` along the smallest jump. */
export function pushAway(tile: Box, from: Box): Push {
  return pushOptions(tile, from)[0]!;
}

/**
 * The nearest free position to `desired`. Candidates are the desired spot and
 * every position flush against an occupied edge, so the search slides along a
 * collider rather than walking a ring of whole cells, and it works on the
 * fractional positions a pointer produces.
 */
export function openSlotNear(desired: AppPreviewTile, occupied: readonly Box[], canvas: WallBounds = DEFAULT_BOUNDS, footprint?: Size): AppPreviewTile | null {
  const start = constrain(desired, canvas, footprint);
  const size = footprint ?? { width: start.width, height: boxOf(start).height };
  const fits = (tile: AppPreviewTile) => !occupied.some((other) => boxesOverlap(boxOf(tile, size), other));
  if (fits(start)) return start;
  const xs = [start.x, ...occupied.flatMap((box) => [box.x - size.width - GAP, box.x + box.width + GAP])];
  const ys = [start.y, ...occupied.flatMap((box) => [box.y - size.height - VERTICAL_CHROME - GAP, box.y + box.height + VERTICAL_CHROME + GAP])];
  let best: AppPreviewTile | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const y of ys) for (const x of xs) {
    const option = constrain({ ...start, x, y }, canvas, footprint);
    const distance = Math.hypot(option.x - start.x, option.y - start.y);
    if (distance < bestDistance && fits(option)) { best = option; bestDistance = distance; }
  }
  return best;
}

type Placement = { readonly tiles: AppPreviewTile[]; readonly contacts: Contact[] };
type Budget = { remaining: number };

/**
 * Placements one reflow may try before giving up. The search is exponential
 * in the worst case and runs on every pointer frame; a wall that needs more
 * than this many guesses is one the user should rearrange by hand.
 */
const PLACEMENT_BUDGET = 48;

/**
 * Places `remaining` one at a time, nearest to the active tile first, so a
 * push travels outward as a chain. A pushed tile tries each way of clearing
 * its collider, nearest first, and backs up when a choice leaves a later tile
 * nowhere to go: the wall is small enough that this search is cheap, and it is
 * what keeps a throw into a crowded corner from being refused.
 */
function placeChain(remaining: readonly AppPreviewTile[], settled: readonly Box[], depth: ReadonlyMap<AppPreviewKey, number>, canvas: WallBounds, budget: Budget): Placement | null {
  const [tile, ...rest] = remaining;
  if (!tile) return { tiles: [], contacts: [] };
  if (budget.remaining <= 0) return null;
  const box = boxOf(tile);
  const collider = settled.find((placed) => boxesOverlap(box, placed));
  const attempts: { readonly desired: AppPreviewTile; readonly contact: Contact | null }[] = collider
    ? pushOptions(box, collider).map((push) => ({
      desired: { ...tile, x: push.x, y: push.y },
      contact: { key: tile.key, pushedBy: collider.key, axis: push.axis, direction: push.direction, depth: (depth.get(collider.key) ?? 0) + 1 },
    }))
    : [{ desired: tile, contact: null }];
  for (const { desired, contact } of attempts) {
    budget.remaining -= 1;
    const placed = openSlotNear(desired, settled, canvas);
    if (!placed) continue;
    const nextDepth = contact ? new Map(depth).set(tile.key, contact.depth) : depth;
    const chain = placeChain(rest, [...settled, boxOf(placed)], nextDepth, canvas, budget);
    if (chain) return { tiles: [placed, ...chain.tiles], contacts: contact ? [contact, ...chain.contacts] : chain.contacts };
  }
  return null;
}

/**
 * Places the active tile at `candidate` and settles everything else around it.
 * Reports each push as a contact so the physics layer can turn geometry into
 * an impulse. A layout that cannot be made collision-free is refused: the
 * neighbours keep their prior places and only the active tile moves.
 */
export function reflowWithContacts(
  tiles: readonly AppPreviewTile[], key: AppPreviewKey, candidate: AppPreviewTile,
  canvas: WallBounds = DEFAULT_BOUNDS, options: ReflowOptions = {},
): ReflowResult {
  const active = tiles.find((tile) => tile.key === key);
  if (!active) return { tiles: [...tiles], contacts: [], refused: false };
  const moved = constrain(candidate, canvas, options.footprint);
  const movedBox = boxOf(moved, options.footprint);
  const distanceToMoved = (tile: AppPreviewTile) => {
    const box = boxOf(tile);
    return Math.hypot(box.x + box.width / 2 - movedBox.x - movedBox.width / 2, box.y + box.height / 2 - movedBox.y - movedBox.height / 2);
  };
  const others = tiles.filter((tile) => tile.key !== key);
  const byDistance = [...others].sort((first, second) => distanceToMoved(first) - distanceToMoved(second));
  // Nearest-first gives the most natural pushes; largest-first is the packing
  // fallback for a crowded wall, because the big frames are the hard ones to seat.
  const byArea = [...others].sort((first, second) => boxOf(second).width * boxOf(second).height - boxOf(first).width * boxOf(first).height);
  const budget = options.budget ?? PLACEMENT_BUDGET;
  const chain = placeChain(byDistance, [movedBox], new Map([[key, 0]]), canvas, { remaining: budget })
    ?? placeChain(byArea, [movedBox], new Map([[key, 0]]), canvas, { remaining: budget });
  // Refused: the neighbours hold their places, but the active tile still goes
  // where it was asked. A dragged frame that stops following the hand reads as
  // broken; a momentary overlap reads as a crowd, and the release resolves it.
  if (!chain) return { tiles: tiles.map((tile) => tile.key === key ? moved : tile), contacts: [], refused: true };
  const placedTiles = [moved, ...chain.tiles];
  return {
    tiles: tiles.map((tile) => placedTiles.find((placed) => placed.key === tile.key) ?? tile),
    contacts: chain.contacts,
    refused: false,
  };
}

export function reflowTiles(tiles: readonly AppPreviewTile[], key: AppPreviewKey, candidate: AppPreviewTile, canvas: WallBounds = DEFAULT_BOUNDS, options: ReflowOptions = {}): AppPreviewTile[] {
  return reflowWithContacts(tiles, key, candidate, canvas, options).tiles;
}
