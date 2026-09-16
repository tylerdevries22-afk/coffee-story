import { join } from 'node:path';

import { PlacesError, type PlaceDetails } from '@platform/engine';

const TENANT_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export type PlaceLocation = { name?: string; placeQuery?: string; googlePlaceId?: string };

export type PlaceOutcome =
  | { kind: 'resolved'; index: number; name: string; place: PlaceDetails }
  | { kind: 'kept'; index: number; name: string; placeId: string }
  | { kind: 'skipped'; index: number; name: string; why: string }
  | { kind: 'failed'; index: number; name: string; why: string };

type Lookup = (query: string) => Promise<PlaceDetails>;

/** Returns the only brand path a tenant slug is allowed to name. */
export function tenantBrandPath(root: string, slug: string): string {
  if (!TENANT_SLUG.test(slug)) {
    throw new Error(`Invalid tenant slug "${slug}"; expected lowercase kebab-case.`);
  }
  return join(root, 'tenants', slug, 'brand.json');
}

async function resolveLocation(
  location: PlaceLocation,
  index: number,
  lookup: Lookup,
  force: boolean,
): Promise<PlaceOutcome> {
  const name = location.name ?? 'unnamed branch';
  if (location.googlePlaceId && !force) {
    return { kind: 'kept', index, name, placeId: location.googlePlaceId };
  }
  if (!location.placeQuery) {
    return { kind: 'skipped', index, name, why: 'no placeQuery to resolve from' };
  }
  try {
    return { kind: 'resolved', index, name, place: await lookup(location.placeQuery) };
  } catch (error) {
    const why = error instanceof PlacesError ? error.code : 'unexpected error';
    return { kind: 'failed', index, name, why };
  }
}

export async function resolveLocations(
  locations: PlaceLocation[],
  lookup: Lookup,
  force: boolean,
): Promise<PlaceOutcome[]> {
  const outcomes: PlaceOutcome[] = [];
  for (const [index, location] of locations.entries()) {
    // Serial on purpose: the provider is metered and tenant branch lists are small.
    outcomes.push(await resolveLocation(location, index, lookup, force));
  }
  return outcomes;
}

/** Applies by stable array position, never by a human-readable and repeatable name. */
export function applyResolvedPlaces(
  locations: PlaceLocation[],
  outcomes: PlaceOutcome[],
): number {
  let applied = 0;
  for (const outcome of outcomes) {
    if (outcome.kind !== 'resolved') continue;
    const location = locations[outcome.index];
    if (!location) continue;
    location.googlePlaceId = outcome.place.placeId;
    applied += 1;
  }
  return applied;
}
