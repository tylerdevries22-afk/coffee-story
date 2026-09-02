import { SPRING } from '@platform/ui/motion';

import type { AppPreviewKey } from '@/lib/app-previews';

import { elasticClamp, shouldHandOff, snapToGrid, startCoast, stepCoast, WALL_PHYSICS, type CoastState } from './app-wall-coast';
import { boxOf, constrain, footprintOf, wallBounds, type AppPreviewTile, type Point, type Size, type WallBounds } from './app-wall-geometry';
import { applyContacts, edgeHitKinetics, kineticsAtRest, massOf, REST_KINETICS, stepKinetics, type KineticsByKey } from './app-wall-impulse';
import { openSlotNear, reflowWithContacts } from './app-wall-reflow';
import { addWallRow, MAX_WALL_ROWS, rowsForPlacement } from './app-wall-rows';

export type Phase = 'idle' | 'dragging' | 'resizing' | 'coasting' | 'settling' | 'turning';
/** Which corner a resize drags; the opposite corner stays put. */
export type Corner = 'nw' | 'ne' | 'sw' | 'se';

export type ActiveTile = {
  readonly key: AppPreviewKey;
  readonly phase: Exclude<Phase, 'idle'>;
  /** The tile as it was when the gesture began; offsets are relative to it. */
  readonly origin: AppPreviewTile;
  readonly coast: CoastState | null;
  /** A mid-turn shape that collision should see instead of the rest footprint. */
  readonly footprint: Size | null;
  readonly corner?: Corner;
};

export type WallState = {
  readonly tiles: AppPreviewTile[];
  readonly canvas: WallBounds;
  readonly active: ActiveTile | null;
  readonly kinetics: KineticsByKey;
  readonly reduced: boolean;
  /** Residual velocity (cells/s) to hand the settle spring after a coast, consumed by the view. */
  readonly handoff: Point | null;
  /** Set when the last gesture asked for a placement the wall could not make. */
  readonly refused: boolean;
};

/** Fixed integration step; real frame time is split into these so a slow frame cannot tunnel a tile through a wall. */
export const SUBSTEP = 1 / 120;
const MAX_FRAME = .032;

export function createWallState(tiles: readonly AppPreviewTile[], canvas: WallBounds, reduced: boolean): WallState {
  return { tiles: [...tiles], canvas, active: null, kinetics: {}, reduced, handoff: null, refused: false };
}

export function tileOf(state: WallState, key: AppPreviewKey): AppPreviewTile | undefined {
  return state.tiles.find((tile) => tile.key === key);
}

export function kineticsOf(state: WallState, key: AppPreviewKey) {
  return state.kinetics[key] ?? REST_KINETICS;
}

export function wallAtRest(state: WallState): boolean {
  return state.active === null && Object.values(state.kinetics).every((kinetics) => !kinetics || kineticsAtRest(kinetics));
}

function massFor(state: WallState) {
  return (key: AppPreviewKey) => { const tile = tileOf(state, key); return tile ? massOf(footprintOf(tile)) : 1; };
}

/** Places the active tile at `candidate`, pushing neighbours and converting each push into an impulse. */
export function placeActive(state: WallState, candidate: AppPreviewTile, velocity: Point, footprint: Size | null = null): WallState {
  if (!state.active) return state;
  const expandable = state.active.phase !== 'turning';
  let canvas = expandable ? rowsForPlacement(state.canvas, state.tiles, candidate, footprint ?? undefined) : state.canvas;
  let result = reflowWithContacts(state.tiles, state.active.key, candidate, canvas, footprint ? { footprint } : {});
  for (let attempt = 0; expandable && result.refused && canvas.rows < MAX_WALL_ROWS && attempt < state.tiles.length; attempt += 1) {
    canvas = addWallRow(canvas, state.tiles, footprint ?? undefined);
    result = reflowWithContacts(state.tiles, state.active.key, candidate, canvas, footprint ? { footprint } : {});
  }
  const applied = applyContacts(state.kinetics, result.contacts, velocity, massFor(state), state.active.key);
  return { ...state, tiles: result.tiles, canvas, kinetics: applied.kinetics, refused: result.refused };
}

export function beginDrag(state: WallState, key: AppPreviewKey): WallState {
  const tile = tileOf(state, key);
  if (!tile || state.active) return state;
  return { ...state, active: { key, phase: 'dragging', origin: tile, coast: null, footprint: null }, handoff: null, refused: false };
}

/** The pointer leads; the rest position stays legal and the excess past an edge becomes a soft visual give. */
export function updateDrag(state: WallState, offset: Point, velocity: Point): WallState {
  const active = state.active;
  if (!active || active.phase !== 'dragging') return state;
  const wanted = { ...active.origin, x: active.origin.x + offset.x, y: active.origin.y + offset.y };
  const placed = placeActive(state, wanted, velocity);
  const limits = wallBounds(footprintOf(wanted), placed.canvas);
  const legal = constrain(wanted, placed.canvas);
  const give = state.reduced ? { x: 0, y: 0 } : {
    x: elasticClamp(wanted.x, limits.minX, limits.maxX) - legal.x,
    y: elasticClamp(wanted.y, limits.minY, limits.maxY) - legal.y,
  };
  return { ...placed, kinetics: { ...placed.kinetics, [active.key]: { offset: give, velocity: { x: 0, y: 0 } } } };
}

/** Snaps the active tile to whole cells and moves to settling; the view finishes the spring. */
function settleActive(state: WallState, velocity: Point): WallState {
  const active = state.active;
  const tile = active ? tileOf(state, active.key) : undefined;
  if (!active || !tile) return state;
  const snapped = { ...tile, ...snapToGrid(tile) };
  let placed = placeActive(state, snapped, { x: 0, y: 0 });
  if (placed.refused) {
    // The nearest free slot, on whole cells where possible; the commit's refit resolves anything left.
    const others = state.tiles.filter((other) => other.key !== active.key).map((other) => boxOf(other));
    const slot = openSlotNear(snapped, others, state.canvas);
    const wholeSlot = slot ? placeActive(state, { ...slot, ...snapToGrid(slot) }, { x: 0, y: 0 }) : null;
    placed = wholeSlot && !wholeSlot.refused ? wholeSlot : slot ? placeActive(state, slot, { x: 0, y: 0 }) : placed;
  }
  const kinetics = { ...placed.kinetics, [active.key]: { offset: kineticsOf(placed, active.key).offset, velocity: { x: 0, y: 0 } } };
  return { ...placed, kinetics, active: { ...active, phase: 'settling', coast: null }, handoff: velocity };
}

export function releaseDrag(state: WallState, velocity: Point): WallState {
  const active = state.active;
  const tile = active ? tileOf(state, active.key) : undefined;
  if (!active || !tile || active.phase !== 'dragging') return state;
  const coast = startCoast({ position: { x: tile.x, y: tile.y }, velocity }, state.reduced);
  if (!coast) return settleActive(state, state.reduced ? { x: 0, y: 0 } : velocity);
  return { ...state, active: { ...active, phase: 'coasting', coast } };
}

/** The view calls this when the settle spring has landed; the wall is idle again. */
export function settle(state: WallState): WallState {
  return { ...state, active: null, handoff: null };
}

function stepCoasting(state: WallState, dt: number): WallState {
  const active = state.active;
  const tile = active ? tileOf(state, active.key) : undefined;
  if (!active || !tile || !active.coast) return state;
  const limits = wallBounds(footprintOf(tile), state.canvas);
  const { state: coast, hits } = stepCoast(active.coast, limits, dt);
  const activeKinetics = hits.reduce((current, hit) => edgeHitKinetics(current, hit), kineticsOf(state, active.key));
  const moved = placeActive({ ...state, kinetics: { ...state.kinetics, [active.key]: activeKinetics } }, { ...tile, ...coast.position }, coast.velocity);
  const next: WallState = { ...moved, active: { ...active, coast } };
  return shouldHandOff(coast, limits) ? settleActive(next, coast.velocity) : next;
}

function stepAllKinetics(state: WallState, dt: number): WallState {
  const kinetics: Partial<Record<AppPreviewKey, ReturnType<typeof stepKinetics>>> = {};
  for (const tile of state.tiles) {
    const current = state.kinetics[tile.key];
    if (!current) continue;
    // The active tile is held by the pointer while dragging, so its give is
    // not stepped; while coasting it presses the wall with the stiff spring.
    if (state.active?.key === tile.key && state.active.phase === 'dragging') { kinetics[tile.key] = current; continue; }
    const stepped = stepKinetics(current, dt, state.active?.key === tile.key ? SPRING.press : SPRING.settle);
    if (!kineticsAtRest(stepped)) kinetics[tile.key] = stepped;
  }
  return { ...state, kinetics };
}

/** Advances the wall by `dt` seconds in fixed substeps. Reduced motion has no kinetic phase at all. */
export function stepWall(state: WallState, dt: number): WallState {
  if (state.reduced) return { ...state, kinetics: {} };
  let current = state;
  let remaining = Math.min(MAX_FRAME, Math.max(0, dt));
  while (remaining > 0) {
    const step = Math.min(SUBSTEP, remaining);
    if (current.active?.phase === 'coasting') current = stepCoasting(current, step);
    current = stepAllKinetics(current, step);
    remaining -= step;
  }
  return current;
}

/** Test helper: the state after `steps` frames of `dt`. */
export function simulateWall(initial: WallState, dt: number, steps: number): WallState[] {
  const states: WallState[] = [];
  let current = initial;
  for (let index = 0; index < steps; index += 1) { current = stepWall(current, dt); states.push(current); }
  return states;
}

export { WALL_PHYSICS };
