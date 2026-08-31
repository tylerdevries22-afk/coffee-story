import 'server-only';

/**
 * The demo's locations, per organization, so the "add a location" wizard is
 * genuinely functional with no database: a created store appears in the list
 * and the header switcher for the rest of the session. Seeded from the tenant
 * registry (Coffee Story keeps its rich fixtures; other orgs their registry
 * stores) and held on globalThis so it survives module reloads within one
 * running server. It is demo-only state -- the live path writes real rows -- so
 * it deliberately does not persist across restarts.
 */
import { DEMO_LOCATIONS, DEMO_SESSION, type LocationSummary } from './demo-data';
import { TENANT_ORGS } from './tenants';

type Store = Map<string, LocationSummary[]>;

function seed(): Store {
  const store: Store = new Map();
  store.set(DEMO_SESSION.brandId, DEMO_LOCATIONS.map((location) => ({ ...location })));
  for (const org of TENANT_ORGS) {
    if (store.has(org.id)) continue;
    store.set(
      org.id,
      org.locations.map((location) => ({
        id: location.id,
        name: location.name,
        city: location.city,
        timezone: 'America/New_York',
        squareConnected: false,
        orderingPaused: false,
        hours: 'Mon–Sun 08:00–20:00',
      })),
    );
  }
  return store;
}

const globalStore = globalThis as unknown as { __hqDemoLocations?: Store };
const store: Store = (globalStore.__hqDemoLocations ??= seed());

export function demoLocationsFor(orgId: string): LocationSummary[] {
  return (store.get(orgId) ?? []).map((location) => ({ ...location }));
}

export function addDemoLocation(orgId: string, location: LocationSummary): void {
  store.set(orgId, [...(store.get(orgId) ?? []), location]);
}
