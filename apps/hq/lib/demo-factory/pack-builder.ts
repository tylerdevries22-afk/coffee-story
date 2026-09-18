/**
 * One business's demo pack, built the way the wizard would build its tenant.
 *
 * The listing becomes an organization draft through the wizard's own parser
 * (parseOrgDraft), and the draft becomes a brand manifest and module list
 * through the same generator a new organization gets (tenantPackFromDraft).
 * So a demo is what that business would get as a tenant, and one that
 * converts needs no translation. What its website adds -- colors, a tagline,
 * its menu, a logo -- is laid over that and the manifest validated again.
 *
 * A listing without machine-readable hours or a time zone is not built: the
 * location form refuses both, and guessing either would show a prospect
 * their own shop open when it is not.
 */
import type { PlaceDetails } from '@platform/engine';
import { buildTenantMenu, parseMenuCsv, type BundledTenantMenu } from '@platform/schema';
import { parseTenantManifest } from '@platform/tenant-config';

import { DEMO_MEDIA_NAME } from '../demo-pack';
import { parseOrgDraft, type BlueprintKey, type IndustryKey, type OrgDraft } from '../org-input';
import type { PlaceDraft } from '../place-to-draft';
import { tenantPackFromDraft } from '../tenant-pack-write';
import { kitMenu, kitText, kitTokens, type DemoBrandKit } from './kit';

const BLUEPRINT = {
  general: 'blank', 'coffee-shop': 'coffee-shop', construction: 'construction', hospitality: 'hospitality',
} as const satisfies Record<IndustryKey, BlueprintKey>;

/** An owner address that can never receive mail: RFC 2606 reserves `.invalid`. */
const NO_OWNER = 'demo-owner@example.invalid';

type Json = Record<string, unknown>;

export type DemoPack = {
  readonly version: 1;
  readonly brand: Json;
  readonly menu: BundledTenantMenu;
  /** `sample` when the business's own menu could not be read, so the page can say so. */
  readonly menuSource: 'website' | 'sample';
  readonly modules: Json;
  readonly media: { readonly logo: string | null; readonly items: Readonly<Record<string, string>> };
  readonly listing: {
    readonly mapsUri: string | null;
    readonly reviewsUri: string | null;
    readonly weekdayDescriptions: readonly string[];
  };
};

export type DemoPackResult =
  | { readonly ok: true; readonly pack: DemoPack; readonly draft: OrgDraft }
  | { readonly ok: false; readonly reason: 'incomplete_listing' | 'invalid_listing' };

function record(value: unknown): Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Json : {};
}

function orgDraftFrom(place: PlaceDraft) {
  const optional = (value: string | null) => value ?? undefined;
  return parseOrgDraft({
    name: place.name,
    ownerEmail: NO_OWNER,
    organizationKind: 'independent',
    industryKey: place.industry.key,
    blueprintKey: BLUEPRINT[place.industry.key],
    website: optional(place.website),
    location: {
      name: place.name,
      street: optional(place.street), city: optional(place.city),
      region: optional(place.region), postal: optional(place.postal),
      timezone: optional(place.timezone),
      hours: place.hours ?? undefined,
      googlePlaceId: place.googlePlaceId,
      lat: place.lat ?? undefined, lng: place.lng ?? undefined,
      phone: optional(place.phone), website: optional(place.website),
    },
  });
}

/** The generated manifest with what the listing and the website say laid over it. */
function brandFrom(generated: Json, place: PlaceDraft, kit: DemoBrandKit | null): Json {
  const tokens = record(generated.tokens);
  const surface = typeof tokens.surface === 'string' ? tokens.surface : '';
  return {
    ...generated,
    tokens: { ...tokens, ...(kit ? kitTokens(kit, surface) : {}) },
    business: {
      ...record(generated.business),
      email: kit?.email ? kitText(kit.email, 254) : '',
      phone: place.phone ?? '',
      website: place.website ?? '',
      tagline: kitText(kit?.tagline, 160),
    },
  };
}

/** The generator's own starter menu, for a business whose menu could not be read. */
function sampleMenu(files: Json): BundledTenantMenu | null {
  const csv = files['menu.csv'];
  const categories = files['menu-categories.json'];
  if (typeof csv !== 'string' || !Array.isArray(categories)) return null;
  const parsed = parseMenuCsv(csv);
  if (parsed.errors.length > 0) return null;
  const built = buildTenantMenu(parsed.rows, categories, {});
  return built.errors.length === 0 ? built.menu : null;
}

export function buildDemoPack(input: {
  readonly place: PlaceDetails;
  readonly draft: PlaceDraft;
  readonly kit: DemoBrandKit | null;
}): DemoPackResult {
  const { place, draft, kit } = input;
  if (draft.hours === null || draft.timezone === null) return { ok: false, reason: 'incomplete_listing' };
  const parsed = orgDraftFrom(draft);
  if (!parsed.ok) return { ok: false, reason: 'invalid_listing' };
  let files: Json;
  try {
    files = tenantPackFromDraft(parsed.draft).files as Json;
  } catch {
    return { ok: false, reason: 'invalid_listing' };
  }
  const brand = brandFrom(record(files['brand.json']), draft, kit);
  if (parseTenantManifest(brand).kind === 'invalid') return { ok: false, reason: 'invalid_listing' };
  const own = kit ? kitMenu(kit) : null;
  const menu = own?.menu ?? sampleMenu(files);
  if (!menu) return { ok: false, reason: 'invalid_listing' };
  const logo = kit?.logo && DEMO_MEDIA_NAME.test(kit.logo) ? kit.logo : null;
  return {
    ok: true,
    draft: parsed.draft,
    pack: {
      version: 1,
      brand,
      menu,
      menuSource: own ? 'website' : 'sample',
      modules: record(files['modules.json']),
      media: { logo, items: own?.images ?? {} },
      listing: {
        mapsUri: place.mapsUri,
        reviewsUri: place.reviewsUri,
        weekdayDescriptions: place.weekdayDescriptions.slice(0, 7),
      },
    },
  };
}
