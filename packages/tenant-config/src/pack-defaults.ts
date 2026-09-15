/**
 * The static parts of a generated tenant pack.
 *
 * Split out so `pack-from-setup.ts` reads as the generator it is, and because
 * these are literals a reviewer compares against `tenants/_template/` rather
 * than logic anyone traces.
 */
export const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
export const SURFACES = ['customer', 'kiosk', 'operator', 'display', 'hq'] as const;

export const DEFAULT_PROVIDERS = [
  { capability: 'database', provider: 'supabase', ownership: 'platform', required: true },
  { capability: 'identity', provider: 'supabase-auth', ownership: 'platform', required: true },
  { capability: 'hosting', provider: 'vercel', ownership: 'platform', required: true },
  { capability: 'payments', provider: 'square', ownership: 'organization', required: true },
] as const;

export const NEUTRAL_TOKENS = {
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

export const DEFAULT_MENU_CSV = [
  'slug,name,category,description,base_price_cents,sizes',
  'house-latte,House Latte,Espresso,"Espresso, steamed milk, and a thin cap of foam.",450,12:450|16:525',
  'drip-coffee,Drip Coffee,Brew Bar,Batch-brewed every hour.,300,',
  'cold-brew,Cold Brew,Brew Bar,Slow-steeped for 18 hours.,475,16:475',
  'banana-bread,Banana Bread,Bakery,Baked fresh every morning.,375,',
  '',
].join('\n');

export const DEFAULT_CATEGORIES = [
  { id: 'espresso', title: 'Espresso', tagline: 'Pulled to order' },
  { id: 'brew-bar', title: 'Brew Bar', tagline: 'Brewed your way' },
  { id: 'bakery', title: 'Bakery', tagline: 'Fresh from the case' },
];

/** Matches `tenants/_template/operations.json`: present, and declaring nothing. */
export const EMPTY_OPERATIONS = {
  roles: [],
  competencies: [],
  templates: [],
  schedules: [],
  escalations: [],
  retention: { evidenceDays: 395, issueDays: 395, actorIdentityDays: 395 },
};

/**
 * `release.json` for a pack that has never been released.
 *
 * Required by the factory publisher, which rejects a package without it -- so a
 * folder created here without one is a folder that cannot ship. Deliberately
 * free of any wall-clock value: an unstable pack means every comparison against
 * a previously written folder reports a change that is not one.
 */
export function emptyRelease(slug: string): Record<string, unknown> {
  return {
    schemaVersion: 2,
    tenantSlug: slug,
    release: { releaseId: '', commitSha: '', artifactDigest: '', createdAt: '' },
    expoGo: {
      appStoreSdk: 54,
      checkedAt: '2026-08-31T00:00:00.000Z',
      sourceUrl: 'https://docs.expo.dev/versions/v54.0.0/',
    },
    checks: {
      productionCredentials: { status: 'pending' },
      providerAccounts: { status: 'pending' },
      legalAndPrivacy: { status: 'pending' },
      storeListings: { status: 'pending' },
      commercialConfiguration: { status: 'pending' },
    },
  };
}

export function emptyTrainingProfile(name: string): Record<string, unknown> {
  return {
    businessName: name,
    industry: '',
    locale: 'en-US',
    website: '',
    products: [],
    services: [],
    complianceTopics: [],
    brandVoice: '',
  };
}
