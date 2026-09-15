import {
  DEFAULT_CATEGORIES, DEFAULT_MENU_CSV, DEFAULT_PROVIDERS, EMPTY_OPERATIONS,
  emptyRelease, emptyTrainingProfile, NEUTRAL_TOKENS, SURFACES, WEEKDAYS,
} from './pack-defaults';
import { parseTenantManifest } from './parser';
import type { OrganizationKind } from './types';

export type TenantSetupLocation = {
  readonly name: string;
  readonly address: Readonly<Record<string, string>>;
  readonly timezone: string;
  readonly hours: Readonly<Record<string, readonly { readonly open: string; readonly close: string }[]>>;
};

export type TenantSetupInput = {
  readonly slug: string;
  readonly name: string;
  readonly ownerEmail: string;
  readonly organizationKind: OrganizationKind;
  readonly networkSlug: string | null;
  readonly location: TenantSetupLocation | null;
  readonly modules: readonly { readonly key: string; readonly version: string }[];
};

export type TenantPackFiles = {
  readonly 'brand.json': Record<string, unknown>;
  readonly 'modules.json': Record<string, unknown>;
  readonly 'operations.json': Record<string, unknown>;
  readonly 'packs.json': Record<string, never>;
  readonly 'release.json': Record<string, unknown>;
  readonly 'training-profile.json': Record<string, unknown>;
  readonly 'README.md': string;
  readonly 'menu.csv': string;
  readonly 'menu-categories.json': unknown;
  readonly 'modifiers.json': Record<string, never>;
};

export type TenantPack = {
  readonly slug: string;
  readonly files: TenantPackFiles;
};

function compactSlug(slug: string): string {
  return slug.replace(/-/g, '');
}

function monogram(name: string): string {
  // Destructured: noUncheckedIndexedAccess does not narrow parts[0] from a length check.
  const [first, second] = name.trim().split(/\s+/).filter(Boolean);
  if (first === undefined) return 'TB';
  if (second === undefined) return first.slice(0, 2).toUpperCase();
  return `${first[0] ?? ''}${second[0] ?? ''}`.toUpperCase();
}

function hoursFor(location: TenantSetupLocation | null): Record<string, { open: string; close: string }[]> {
  const source = location?.hours ?? {};
  const hours: Record<string, { open: string; close: string }[]> = {};
  for (const day of WEEKDAYS) {
    const spans = source[day];
    hours[day] = spans
      ? spans.map((span) => ({ open: span.open, close: span.close }))
      : location
        ? []
        : [{ open: '08:00', close: '17:00' }];
  }
  if (!location) {
    hours.sat = [];
    hours.sun = [];
  }
  return hours;
}

function locationFrom(input: TenantSetupInput): Record<string, unknown> {
  const location = input.location;
  return {
    name: location?.name || 'Main',
    address: {
      street: location?.address.street ?? '',
      city: location?.address.city ?? '',
      region: location?.address.region ?? '',
      postal: location?.address.postal ?? '',
    },
    timezone: location?.timezone || 'America/Denver',
    hours: hoursFor(location),
  };
}

/** Build a tenant folder payload from wizard input. Does not touch disk. */
export function tenantPackFromSetup(input: TenantSetupInput): TenantPack {
  const networkKind = input.organizationKind === 'franchisor' || input.organizationKind === 'franchisee';
  const compact = compactSlug(input.slug);
  const mark = monogram(input.name);
  const brand = {
    schemaVersion: 1,
    organization: { kind: input.organizationKind },
    network: networkKind && input.networkSlug
      ? {
        slug: input.networkSlug,
        relationship: input.organizationKind === 'franchisor' ? 'owner' : 'member',
      }
      : null,
    inheritance: input.organizationKind === 'franchisee'
      ? { mode: 'network', sourceTenantSlug: input.networkSlug, revision: 1, overrides: [] }
      : { mode: 'standalone', sourceTenantSlug: null, revision: 1, overrides: [] },
    surfaces: [...SURFACES],
    providers: DEFAULT_PROVIDERS.map((provider) => ({ ...provider })),
    identity: {
      slug: input.slug,
      name: input.name,
      bundleId: `com.${compact}.app`,
      scheme: input.slug,
      kioskBundleId: `com.${compact}.kiosk`,
      kioskScheme: `${input.slug}-kiosk`,
      easProjectId: '',
      kioskEasProjectId: '',
    },
    tokens: { ...NEUTRAL_TOKENS },
    copy: {
      appName: input.name,
      pointsName: 'Points',
      orderCta: 'Start an order',
      earnBanner: 'Earn {points} {pointsName} for this order',
      memberFallback: 'Member',
    },
    features: {
      drops: true,
      catering: false,
      delivery: false,
      multi_location: false,
      sms: false,
      stored_value: false,
      referrals: false,
      operations: false,
    },
    locations: [locationFrom(input)],
    business: {
      legalName: input.name,
      tagline: '',
      email: input.ownerEmail,
      phone: '',
      website: '',
      giftCodePrefix: mark,
      monogram: mark,
    },
  };
  const parsed = parseTenantManifest(brand);
  if (parsed.kind === 'invalid') {
    throw new Error(`Generated tenant pack is invalid: ${parsed.issues.join('; ')}`);
  }
  // release.json is the factory publisher's hard requirement, and this
  // generator used to omit it -- so a folder created from the console was one
  // that could never ship, and nothing said so until a publish failed.
  const release = emptyRelease(input.slug);
  if (release.schemaVersion !== 2 || release.tenantSlug !== input.slug) {
    throw new Error('Generated release.json does not bind this tenant at schemaVersion 2.');
  }
  return {
    slug: input.slug,
    files: {
      'brand.json': brand,
      'modules.json': {
        schemaVersion: 1,
        // Neither `surfaces` nor `config` is invented here. This generator
        // claimed all five surfaces for every module, which is wrong for any
        // module that does not serve all five -- commerce-catalog serves four
        // -- and named a `modules/<key>.json` it never wrote. Both failed
        // onboarding validation, so a folder created from the console has never
        // passed it. An omitted `surfaces` means unconstrained, which is the
        // truth: the registry knows which surfaces a module serves, and this
        // does not.
        modules: input.modules.map((module) => ({
          key: module.key,
          version: module.version,
          enabled: true,
        })),
      },
      'operations.json': EMPTY_OPERATIONS,
      'packs.json': {},
      'release.json': release,
      'training-profile.json': emptyTrainingProfile(input.name),
      'README.md': `# ${input.name}\n\nGenerated tenant pack. See tenants/README.md.\n`,
      'menu.csv': DEFAULT_MENU_CSV,
      'menu-categories.json': DEFAULT_CATEGORIES,
      'modifiers.json': {},
    },
  };
}
