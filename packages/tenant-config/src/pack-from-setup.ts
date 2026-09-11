import { parseTenantManifest } from './parser';
import type { OrganizationKind } from './types';

const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
const SURFACES = ['customer', 'kiosk', 'operator', 'display', 'hq'] as const;

const DEFAULT_PROVIDERS = [
  { capability: 'database', provider: 'supabase', ownership: 'platform', required: true },
  { capability: 'identity', provider: 'supabase-auth', ownership: 'platform', required: true },
  { capability: 'hosting', provider: 'vercel', ownership: 'platform', required: true },
  { capability: 'payments', provider: 'square', ownership: 'organization', required: true },
] as const;

const NEUTRAL_TOKENS = {
  primary: '#1C1917',
  secondary: '#44403C',
  surface: '#FAFAF9',
  surfaceElevated: '#FFFFFF',
  accent: '#8A7350',
  textPrimary: '#1C1917',
  textMuted: '#57534E',
  success: '#2F6844',
  warning: '#8A5A1E',
  danger: '#9B3B32',
  fontDisplay: 'System',
  fontBody: 'System',
};

const DEFAULT_MENU_CSV = [
  'slug,name,category,description,base_price_cents,sizes',
  'house-latte,House Latte,Espresso,"Espresso, steamed milk, and a thin cap of foam.",450,12:450|16:525',
  'drip-coffee,Drip Coffee,Brew Bar,Batch-brewed every hour.,300,',
  'cold-brew,Cold Brew,Brew Bar,Slow-steeped for 18 hours.,475,16:475',
  'banana-bread,Banana Bread,Bakery,Baked fresh every morning.,375,',
  '',
].join('\n');

const DEFAULT_CATEGORIES = [
  { id: 'espresso', title: 'Espresso', tagline: 'Pulled to order' },
  { id: 'brew-bar', title: 'Brew Bar', tagline: 'Brewed your way' },
  { id: 'bakery', title: 'Bakery', tagline: 'Fresh from the case' },
];

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
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'TB';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] ?? ''}${parts[1][0] ?? ''}`.toUpperCase();
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
  return {
    slug: input.slug,
    files: {
      'brand.json': brand,
      'modules.json': {
        schemaVersion: 1,
        modules: input.modules.map((module) => ({
          key: module.key,
          version: module.version,
          config: `modules/${module.key}.json`,
          surfaces: [...SURFACES],
          enabled: true,
        })),
      },
      'menu.csv': DEFAULT_MENU_CSV,
      'menu-categories.json': DEFAULT_CATEGORIES,
      'modifiers.json': {},
    },
  };
}
