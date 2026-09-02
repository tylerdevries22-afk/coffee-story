import type { AppPreviewKey } from '@/lib/app-previews';

import { fitLayout } from './app-wall-fit';
import { constrain, footprintOf, heightOf, lerpFootprint, rotatedTile, tileAspect, type AppPreviewTile, type Orientation, type Point, type Size } from './app-wall-geometry';
import { placeActive, settle, tileOf, type Corner, type WallState } from './app-wall-sim';

const NO_VELOCITY: Point = { x: 0, y: 0 };

export function beginResize(state: WallState, key: AppPreviewKey, corner: Corner = 'se'): WallState {
  const tile = tileOf(state, key);
  if (!tile || state.active) return state;
  return { ...state, active: { key, phase: 'resizing', origin: tile, coast: null, footprint: null, corner }, handoff: null, refused: false };
}

/** The tile resized to `width` about the corner opposite the one being dragged, so that corner stays under the hand's anchor. */
export function resizedFromCorner(origin: AppPreviewTile, width: number, corner: Corner): AppPreviewTile {
  const height = heightOf({ ...origin, width });
  return {
    ...origin,
    width,
    x: corner === 'nw' || corner === 'sw' ? origin.x + origin.width - width : origin.x,
    y: corner === 'nw' || corner === 'ne' ? origin.y + heightOf(origin) - height : origin.y,
  };
}

/** A corner drag: the larger of the two pointer deltas wins, expressed as width so the aspect is kept. */
export function updateResize(state: WallState, offset: Point): WallState {
  const active = state.active;
  if (!active || active.phase !== 'resizing') return state;
  const corner = active.corner ?? 'se';
  const dx = corner === 'nw' || corner === 'sw' ? -offset.x : offset.x;
  const dy = corner === 'nw' || corner === 'ne' ? -offset.y : offset.y;
  const width = active.origin.width + Math.max(dx, dy * tileAspect(active.origin));
  return placeActive(state, resizedFromCorner(active.origin, width, corner), NO_VELOCITY);
}

export function endResize(state: WallState): WallState {
  const active = state.active;
  const tile = active ? tileOf(state, active.key) : undefined;
  if (!active || !tile || active.phase !== 'resizing') return state;
  const placed = placeActive(state, { ...resizedFromCorner(tile, Math.round(tile.width), active.corner ?? 'se'), sized: true }, NO_VELOCITY);
  return { ...placed, active: { ...active, phase: 'settling' } };
}

/** A whole-cell nudge or resize from the keyboard; no gesture, no kinetics, so nothing is nudged. */
export function moveTile(state: WallState, key: AppPreviewKey, candidate: AppPreviewTile): WallState {
  if (state.active) return state;
  const began: WallState = { ...state, active: { key, phase: 'settling', origin: candidate, coast: null, footprint: null } };
  return settle(placeActive(began, candidate, NO_VELOCITY));
}

/** The footprint of `tile` seen at turn progress `t`, where 0 is landscape and 1 is portrait. */
export function turnFootprint(tile: AppPreviewTile, t: number): Size {
  const landscape = tile.orientation === 'landscape' ? tile : rotatedTile(tile);
  const portrait = tile.orientation === 'portrait' ? tile : rotatedTile(tile);
  return lerpFootprint(footprintOf(landscape), footprintOf(portrait), t);
}

export function turnTargetOf(orientation: Orientation): number {
  return orientation === 'portrait' ? 1 : 0;
}

/**
 * The wall re-packed around `tile` in place of its current version, or null
 * when even a refit cannot seat it. The refit may scale the wall down and the
 * fill then grows it back, so this is how a rotate finds room the neighbours
 * were not leaving.
 */
function refitAround(state: WallState, key: AppPreviewKey, tile: AppPreviewTile): AppPreviewTile[] | null {
  const fitted = fitLayout({ bounds: state.canvas, tiles: state.tiles.map((other) => other.key === key ? tile : other) }, state.canvas);
  return fitted.mode === 'fitted' ? fitted.tiles : null;
}

/**
 * Starts a turn. When the rotated device fits where it stands the neighbours
 * yield frame by frame; when it does not, the wall is refitted around the
 * rotated shape first so the turn has room to happen in. Null only when even
 * a refit cannot seat it: the one case where a rotate is refused.
 */
export function beginTurn(state: WallState, key: AppPreviewKey): WallState | null {
  const tile = tileOf(state, key);
  if (!tile || state.active) return null;
  const rotated = constrain(rotatedTile(tile), state.canvas);
  const probe: WallState = { ...state, active: { key, phase: 'turning', origin: tile, coast: null, footprint: null }, refused: false };
  if (!placeActive(probe, rotated, NO_VELOCITY).refused) return probe;
  const fitted = refitAround(state, key, rotated);
  const target = fitted?.find((other) => other.key === key);
  if (!fitted || !target) return null;
  // Turn from where the refit put it, in its current orientation, so the spring still describes one quarter turn.
  const origin = constrain(rotatedTile(target), state.canvas);
  return { ...probe, tiles: fitted.map((other) => other.key === key ? origin : other), active: { ...probe.active!, origin } };
}

/**
 * Each frame of the turn: the collision shape follows the spring, so
 * neighbours yield live. The diagonal is bulkier than either rest shape; when
 * it cannot be seated the neighbours take the positions the finished turn
 * needs, so they still move with the turn rather than jumping after it.
 */
export function updateTurn(state: WallState, t: number): WallState {
  const active = state.active;
  if (!active || active.phase !== 'turning') return state;
  const origin = footprintOf(active.origin);
  const footprint = turnFootprint(active.origin, t);
  const centred = (shape: Size) => ({ ...active.origin, x: active.origin.x + (origin.width - shape.width) / 2, y: active.origin.y + (origin.height - shape.height) / 2 });
  let placed = placeActive(state, centred(footprint), NO_VELOCITY, footprint);
  for (const rest of [1, 0]) {
    if (!placed.refused) break;
    const shape = turnFootprint(active.origin, rest);
    placed = placeActive(state, centred(shape), NO_VELOCITY, shape);
  }
  return { ...placed, active: { ...active, footprint } };
}

/** Commits the orientation the spring landed nearest; a turn cancelled mid-flight lands back where it began. */
export function finishTurn(state: WallState, t: number): WallState {
  const active = state.active;
  if (!active || active.phase !== 'turning') return state;
  const orientation: Orientation = t >= .5 ? 'portrait' : 'landscape';
  const target = orientation === active.origin.orientation ? active.origin : rotatedTile(active.origin);
  let placed = placeActive(state, constrain(target, state.canvas), NO_VELOCITY);
  if (placed.refused) {
    const fitted = refitAround(state, active.key, constrain(target, state.canvas));
    placed = fitted ? { ...state, tiles: fitted, refused: false } : { ...placeActive(state, active.origin, NO_VELOCITY), refused: true };
  }
  return { ...placed, active: { ...active, phase: 'settling', footprint: null } };
}
