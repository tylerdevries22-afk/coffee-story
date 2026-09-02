import type { Point, WallLimits } from './app-wall-geometry';

/** Rates and distances in cells; none of these is a duration, so none belongs in the token sheet. */
export const WALL_PHYSICS = {
  /** Exponential decay rate of a coast, per second. Higher stops sooner. */
  COAST_DECAY: 6,
  /** Releases slower than this (cells/s) simply snap; a barely moving tile that drifts reads as broken. */
  COAST_MIN_SPEED: 4,
  /** Below this speed the coast hands off to the settle spring. */
  REST_SPEED: 1.5,
  /** The furthest a throw may travel, so no fling leaves the wall it started on. */
  MAX_COAST_CELLS: 14,
  /** Within this distance of its projected rest the coast hands off early. */
  HANDOFF_CELLS: .75,
  /** Velocity kept after an edge bounce; a wall, not a trampoline. */
  EDGE_RESTITUTION: .3,
  /** How far past an edge a dragged tile may be stretched before it stops giving. */
  EDGE_GIVE_CELLS: .6,
  /** The largest visual shove a neighbour takes from a contact. */
  MAX_NUDGE_CELLS: .6,
  /** Share of normal velocity handed to a directly struck neighbour. */
  CONTACT_TRANSFER: .55,
  /** Further decay per link in a push chain. */
  CHAIN_TRANSFER: .5,
} as const;

export type CoastState = { readonly position: Point; readonly velocity: Point };
export type EdgeHit = { readonly axis: 'x' | 'y'; readonly direction: -1 | 1; readonly speed: number };
export type CoastStep = { readonly state: CoastState; readonly hits: EdgeHit[] };

const speedOf = (velocity: Point) => Math.hypot(velocity.x, velocity.y);

/** A coast for this release, or null when it should snap instead. Speed is capped so travel never exceeds MAX_COAST_CELLS. */
export function startCoast(release: CoastState, reduced: boolean): CoastState | null {
  const speed = speedOf(release.velocity);
  if (reduced || speed < WALL_PHYSICS.COAST_MIN_SPEED) return null;
  const ceiling = WALL_PHYSICS.MAX_COAST_CELLS * WALL_PHYSICS.COAST_DECAY;
  const factor = speed > ceiling ? ceiling / speed : 1;
  return { position: release.position, velocity: { x: release.velocity.x * factor, y: release.velocity.y * factor } };
}

function reflect(value: number, velocity: number, min: number, max: number, axis: 'x' | 'y', hits: EdgeHit[]): [number, number] {
  if (value < min) { hits.push({ axis, direction: -1, speed: Math.abs(velocity) }); return [min, -velocity * WALL_PHYSICS.EDGE_RESTITUTION]; }
  if (value > max) { hits.push({ axis, direction: 1, speed: Math.abs(velocity) }); return [max, -velocity * WALL_PHYSICS.EDGE_RESTITUTION]; }
  return [value, velocity];
}

/** Semi-implicit Euler with exponential decay; a crossing of a bound reflects with restitution and is reported. */
export function stepCoast(state: CoastState, limits: WallLimits, dt: number): CoastStep {
  const decay = Math.exp(-WALL_PHYSICS.COAST_DECAY * dt);
  const hits: EdgeHit[] = [];
  const [x, vx] = reflect(state.position.x + state.velocity.x * decay * dt, state.velocity.x * decay, limits.minX, limits.maxX, 'x', hits);
  const [y, vy] = reflect(state.position.y + state.velocity.y * decay * dt, state.velocity.y * decay, limits.minY, limits.maxY, 'y', hits);
  return { state: { position: { x, y }, velocity: { x: vx, y: vy } }, hits };
}

/** Where the coast would come to rest with no further contact, clamped to the wall. */
export function projectedRest(state: CoastState, limits: WallLimits): Point {
  return {
    x: Math.min(limits.maxX, Math.max(limits.minX, state.position.x + state.velocity.x / WALL_PHYSICS.COAST_DECAY)),
    y: Math.min(limits.maxY, Math.max(limits.minY, state.position.y + state.velocity.y / WALL_PHYSICS.COAST_DECAY)),
  };
}

export function shouldHandOff(state: CoastState, limits: WallLimits): boolean {
  const rest = projectedRest(state, limits);
  return speedOf(state.velocity) < WALL_PHYSICS.REST_SPEED
    || Math.hypot(rest.x - state.position.x, rest.y - state.position.y) < WALL_PHYSICS.HANDOFF_CELLS;
}

export function snapToGrid(point: Point): Point {
  return { x: Math.round(point.x), y: Math.round(point.y) };
}

/** A soft clamp: inside the range it is the identity, past it the excess saturates at `give`. */
export function elasticClamp(value: number, min: number, max: number, give: number = WALL_PHYSICS.EDGE_GIVE_CELLS): number {
  if (value >= min && value <= max) return value;
  const bound = value < min ? min : max;
  return give > 0 ? bound + give * Math.tanh((value - bound) / give) : bound;
}
