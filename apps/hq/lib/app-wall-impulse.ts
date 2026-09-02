import { SPRING } from '@platform/ui/motion';

import type { AppPreviewKey } from '@/lib/app-previews';

import { WALL_PHYSICS, type EdgeHit } from './app-wall-coast';
import type { Point, Size } from './app-wall-geometry';
import type { Contact } from './app-wall-reflow';

/** A bounded visual displacement on top of a tile's rest position. Never part of collision. */
export type TileKinetics = { readonly offset: Point; readonly velocity: Point };
export type KineticsByKey = Readonly<Partial<Record<AppPreviewKey, TileKinetics>>>;
export type SpringConstants = { readonly damping: number; readonly stiffness: number; readonly mass?: number };

export const REST_KINETICS: TileKinetics = { offset: { x: 0, y: 0 }, velocity: { x: 0, y: 0 } };

/** Footprint area stands in for mass, so the console shrugs off a phone and a phone flies from the console. */
export function massOf(footprint: Size): number {
  return Math.max(1, footprint.width * footprint.height);
}

/**
 * The velocity a struck neighbour picks up: a one-dimensional elastic exchange
 * along the contact axis, only for the component pointing into it, decayed by
 * depth along a chain. Zero velocity gives zero impulse, so a keyboard move
 * never nudges anything.
 */
export function contactImpulse(activeVelocity: Point, activeMass: number, targetMass: number, contact: Contact): Point {
  const normal = activeVelocity[contact.axis] * contact.direction;
  if (normal <= 0) return { x: 0, y: 0 };
  const exchange = (2 * activeMass / (activeMass + targetMass)) * normal;
  const transfer = WALL_PHYSICS.CONTACT_TRANSFER * WALL_PHYSICS.CHAIN_TRANSFER ** Math.max(0, contact.depth - 1);
  const along = exchange * transfer * contact.direction;
  return contact.axis === 'x' ? { x: along, y: 0 } : { x: 0, y: along };
}

/** The active tile's velocity after striking a neighbour: it loses in proportion to what it hit. */
export function activeAfterContact(activeVelocity: Point, activeMass: number, targetMass: number, contact: Contact): Point {
  if (contact.depth !== 1) return activeVelocity;
  const normal = activeVelocity[contact.axis] * contact.direction;
  if (normal <= 0) return activeVelocity;
  const loss = normal * (targetMass / (activeMass + targetMass)) * WALL_PHYSICS.CONTACT_TRANSFER * contact.direction;
  return contact.axis === 'x' ? { x: activeVelocity.x - loss, y: activeVelocity.y } : { x: activeVelocity.x, y: activeVelocity.y - loss };
}

export function applyContacts(
  kinetics: KineticsByKey, contacts: readonly Contact[], activeVelocity: Point, massByKey: (key: AppPreviewKey) => number, activeKey: AppPreviewKey,
): { readonly kinetics: KineticsByKey; readonly activeVelocity: Point } {
  const next: Partial<Record<AppPreviewKey, TileKinetics>> = { ...kinetics };
  let velocity = activeVelocity;
  const activeMass = massByKey(activeKey);
  for (const contact of contacts) {
    const impulse = contactImpulse(activeVelocity, activeMass, massByKey(contact.key), contact);
    const current = next[contact.key] ?? REST_KINETICS;
    next[contact.key] = { offset: current.offset, velocity: { x: current.velocity.x + impulse.x, y: current.velocity.y + impulse.y } };
    velocity = activeAfterContact(velocity, activeMass, massByKey(contact.key), contact);
  }
  return { kinetics: next, activeVelocity: velocity };
}

const clampNudge = (value: number) => Math.min(WALL_PHYSICS.MAX_NUDGE_CELLS, Math.max(-WALL_PHYSICS.MAX_NUDGE_CELLS, value));

/** One step of a damped spring pulling the offset back to zero. */
export function stepKinetics(kinetics: TileKinetics, dt: number, spring: SpringConstants = SPRING.settle): TileKinetics {
  const mass = spring.mass ?? 1;
  const accelerate = (offset: number, velocity: number) => (-spring.stiffness * offset - spring.damping * velocity) / mass;
  const vx = kinetics.velocity.x + accelerate(kinetics.offset.x, kinetics.velocity.x) * dt;
  const vy = kinetics.velocity.y + accelerate(kinetics.offset.y, kinetics.velocity.y) * dt;
  return { offset: { x: clampNudge(kinetics.offset.x + vx * dt), y: clampNudge(kinetics.offset.y + vy * dt) }, velocity: { x: vx, y: vy } };
}

/** An edge hit carries the lost speed into the visual offset, so the tile visibly presses the wall and rebounds. */
export function edgeHitKinetics(kinetics: TileKinetics, hit: EdgeHit): TileKinetics {
  const push = hit.speed * hit.direction * WALL_PHYSICS.EDGE_RESTITUTION;
  return hit.axis === 'x'
    ? { ...kinetics, velocity: { x: kinetics.velocity.x + push, y: kinetics.velocity.y } }
    : { ...kinetics, velocity: { x: kinetics.velocity.x, y: kinetics.velocity.y + push } };
}

export function kineticsAtRest(kinetics: TileKinetics): boolean {
  return Math.abs(kinetics.offset.x) < .002 && Math.abs(kinetics.offset.y) < .002
    && Math.abs(kinetics.velocity.x) < .02 && Math.abs(kinetics.velocity.y) < .02;
}
