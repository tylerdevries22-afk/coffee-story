/**
 * What one property's lobby screen shows.
 *
 * The screen stands in a hotel's own entrance, so it is that property's page --
 * not the chain's, and not a generic template with the name swapped. Everything
 * here is resolved from one `(slug, locationId)` pair, which is what makes two
 * branches of the same chain two different screens rather than one screen shown
 * twice.
 *
 * Section order is not decided here. It comes from `lobbySectionsFor` in
 * `@platform/domain`, which mirrors the partner's own published page; a screen
 * that reordered or invented sections would be a different page wearing the
 * hotel's name.
 */
import { lobbySectionsFor, type LobbySection, type LobbyPageType } from '@platform/domain';

import { TENANT_ORGS, type TenantOrg } from './tenants';

export type LobbyBranch = {
  readonly id: string;
  readonly name: string;
  readonly city: string;
  readonly timezone: string;
  readonly hours: string;
};

export type LobbyScreen = {
  readonly slug: string;
  readonly brandName: string;
  readonly tagline: string | null;
  readonly branch: LobbyBranch;
  /** Every branch of this chain, so the screen can say which one it is. */
  readonly siblings: readonly LobbyBranch[];
  readonly address: readonly string[];
  readonly note: string | null;
  readonly phone: string | null;
  readonly website: string | null;
  /** Set once a Places lookup has resolved and verified the listing. */
  readonly placeId: string | null;
  /** The property as a person names it, which is what a lookup resolves. */
  readonly placeQuery: string | null;
  readonly weekly: readonly { readonly day: string; readonly span: string }[];
  readonly sections: readonly LobbySection[];
  readonly brandConfig: unknown;
};

type RawLocation = {
  name?: string;
  note?: string;
  timezone?: string;
  googlePlaceId?: string;
  placeQuery?: string;
  address?: Record<string, string>;
  hours?: Record<string, readonly { open?: string; close?: string }[]>;
};

type RawBrand = {
  identity?: { name?: string };
  business?: { tagline?: string; supportEmail?: string; website?: string; industryKey?: string };
  locations?: RawLocation[];
};

const DAYS = [
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
] as const;

function raw(org: TenantOrg): RawBrand {
  return (org.brandConfig ?? {}) as RawBrand;
}

/**
 * Whether this tenant's screen is a venue's entrance at all.
 *
 * Read from the tenant's own declared surface rather than its industry: a
 * hospitality brand that ships no `lobby` has no screen to serve, and serving
 * one anyway would invent a product it never asked for.
 */
export function servesLobby(org: TenantOrg): boolean {
  const surfaces = (org.brandConfig as { surfaces?: unknown })?.surfaces;
  return Array.isArray(surfaces) && surfaces.includes('lobby');
}

/** Tenants whose branches each get a screen. */
export function lobbyTenants(): readonly TenantOrg[] {
  return TENANT_ORGS.filter(servesLobby);
}

function addressLines(location: RawLocation | undefined): readonly string[] {
  const parts = location?.address ?? {};
  const street = [parts.line1, parts.line2].filter(Boolean).join(', ');
  const region = [parts.city, parts.region, parts.postalCode].filter(Boolean).join(' ');
  return [street, region].filter((line): line is string => Boolean(line && line.length > 0));
}

/** `09:00-17:00` per day, or `Closed` -- never a guessed default. */
function weekly(location: RawLocation | undefined): readonly { day: string; span: string }[] {
  const hours = location?.hours ?? {};
  return DAYS.map((day) => {
    const spans = hours[day] ?? [];
    const open = spans.filter((span) => span.open && span.close)
      .map((span) => `${span.open}–${span.close}`);
    // A round-the-clock front desk is written as a full span in the manifest;
    // rendering it back as `00:00-23:59` would read as a bug to a guest.
    const allDay = open.length === 1 && open[0] === '00:00–23:59';
    return {
      day: day.charAt(0).toUpperCase() + day.slice(1),
      span: allDay ? 'Open 24 hours' : open.length > 0 ? open.join(', ') : 'Closed',
    };
  });
}

function branchOf(org: TenantOrg, index: number): LobbyBranch | null {
  return org.locations[index] ?? null;
}

/**
 * The screen for one branch, or null when either the tenant or the branch is
 * not one this console serves.
 *
 * Returning null rather than a partly-filled screen is deliberate: a lobby
 * device that received a stranger's hotel would be worse than one showing
 * nothing, and the caller can render a 404 it can reason about.
 */
export function lobbyScreen(
  slug: string,
  locationId: string,
  pageType: LobbyPageType = 'hotel',
): LobbyScreen | null {
  const org = TENANT_ORGS.find((entry) => entry.slug === slug);
  if (!org || !servesLobby(org)) return null;
  const index = org.locations.findIndex((location) => location.id === locationId);
  const branch = index >= 0 ? branchOf(org, index) : null;
  if (!branch) return null;
  const config = raw(org);
  const location = config.locations?.[index];
  return {
    slug: org.slug,
    brandName: config.identity?.name ?? org.name,
    tagline: config.business?.tagline ?? null,
    branch,
    siblings: org.locations,
    address: addressLines(location),
    note: location?.note ?? null,
    phone: null,
    website: config.business?.website ?? null,
    placeId: location?.googlePlaceId ?? null,
    placeQuery: location?.placeQuery ?? null,
    weekly: weekly(location),
    sections: lobbySectionsFor(pageType),
    brandConfig: org.brandConfig,
  };
}

/**
 * Where this tenant's lobby screen is served, or null when it has none.
 *
 * Path-routed on the console's own origin, like every other Model B surface:
 * each hosted surface answers `frame-ancestors 'self'`, so a wall tile pointed
 * at another origin is refused by the browser and paints blank.
 *
 * `locationId` picks the branch. It defaults to the chain's first, because a
 * tile has to show *a* property and the alternative is an empty frame -- but a
 * caller that knows which device it is looking at should say so, or every
 * branch of a chain shows the flagship.
 */
export function lobbySurfaceUrl(
  org: TenantOrg, origin = '', locationId?: string | null,
): string | null {
  if (!servesLobby(org)) return null;
  const branch = org.locations.find((location) => location.id === locationId)
    ?? org.locations[0];
  if (!branch) return null;
  return `${origin.replace(/\/$/, '')}/lobby/${org.slug}/${branch.id}`;
}

/** Every `(slug, locationId)` pair that has a screen. Used to build the wall. */
export function lobbyRoutes(): readonly { slug: string; locationId: string; name: string }[] {
  return lobbyTenants().flatMap((org) =>
    org.locations.map((location) => ({
      slug: org.slug, locationId: location.id, name: location.name,
    })));
}
