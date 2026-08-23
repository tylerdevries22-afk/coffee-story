/**
 * The shop's own details.
 *
 * The staff app is ONE listing for every tenant — tenancy is by login (rule 7)
 * — so unlike the guest binary it cannot bake a brand in at build time. The
 * real identity is the signed-in staff member's brand row; the constants below
 * are the demo fallback, nothing more. They are still Coffee Story's because
 * demo mode is Coffee Story's shop.
 *
 * Reading `BUSINESS` directly in a screen is therefore a bug: it shows Coffee
 * Story's name, mark, phone and website to whichever tenant's staff happen to
 * be signed in. Use `useBusiness()` (state/business.ts) in components, and
 * `currentBusiness()` in the plain helpers that cannot hold a hook.
 *
 * Pure — no asset imports — so both the app and `node:test` can read it.
 */

export const BUSINESS = {
  name: 'Coffee Story',
  legalName: 'Coffee Story by Barakah Brews',
  tagline: 'A Blessing In Every Cup',
  /** Confirm this mailbox is live before the app tells guests to write to it. */
  email: 'hello@coffeestoryco.com',
  phone: '(720) 609-2971',
  street: '2222 S Havana St Unit A1',
  cityLine: 'Aurora, CO 80014',
  website: 'https://coffeestoryco.com',
  /** Prefix on every gift-card code the app issues. */
  giftCodePrefix: 'CS',
  /** The shop's wall-clock zone: pickup windows, calendar events, hours. */
  timezone: 'America/Denver',
} as const;

export const BUSINESS_ADDRESS = `${BUSINESS.street}, ${BUSINESS.cityLine}`;

/** The two-letter mark the app falls back to when there is no name or photo. */
export const BUSINESS_MONOGRAM = 'CS';

export type BusinessDetails = {
  name: string;
  legalName: string;
  tagline: string;
  email: string;
  phone: string;
  street: string;
  cityLine: string;
  website: string;
  giftCodePrefix: string;
  monogram: string;
  timezone: string;
};

/** The location row the address and wall-clock zone come from (rule 1). */
export type BusinessLocationSource = {
  address?: { street?: string; city?: string; region?: string; postal?: string } | null;
  timezone?: string | null;
} | null;

export const DEMO_BUSINESS: BusinessDetails = {
  ...BUSINESS,
  monogram: BUSINESS_MONOGRAM,
};

/**
 * Up to three letters from a shop name, for the no-photo avatar fallback.
 *
 * Blank when the name is blank -- a shop we have not identified yet shows no
 * mark rather than the bundled tenant's, which is the whole point of this
 * module.
 */
function monogramOf(name: string): string {
  return name
    .split(/\s+/)
    .map((word) => word.replace(/[^\p{L}\p{N}]/gu, '')[0] ?? '')
    .filter(Boolean)
    .join('')
    .toUpperCase()
    .slice(0, 3);
}

/**
 * The signed-in staff member's shop, out of the brand row.
 *
 * `brand_config` carries what `tenants/<slug>/brand.json` puts there:
 * `identity`, `tokens`, `copy` and `business`. It does NOT carry the shop's
 * name (that is the `brands.name` column) nor its address (that belongs to the
 * location row, rule 1) — the previous version of this function looked for
 * `business.name`, `business.street` and `business.cityLine`, which no tenant
 * file has ever written, so those three could only ever return Coffee Story.
 * That was moot until now, because nothing called it at all.
 */
export function businessFromBrandConfig(
  brandConfig: unknown,
  brandName?: string | null,
  location?: BusinessLocationSource,
): BusinessDetails {
  const config = (brandConfig ?? {}) as {
    business?: Record<string, unknown>;
    copy?: Record<string, unknown>;
  };
  const configured = config.business ?? {};
  const text = (key: string, fallback: string): string => {
    const value = configured[key];
    return typeof value === 'string' && value.trim().length > 0 ? value : fallback;
  };
  const address = location?.address ?? null;
  const appName = config.copy?.appName;
  // Blank until the brand row lands: during that window, and after a failed
  // load, the app knows no shop -- and must not answer with the bundled one.
  const name = brandName?.trim() || (typeof appName === 'string' ? appName.trim() : '');
  const cityLine = [
    [address?.city, address?.region].filter(Boolean).join(', '),
    address?.postal,
  ].filter(Boolean).join(' ');

  return {
    name,
    legalName: text('legalName', name),
    tagline: text('tagline', ''),
    email: text('email', ''),
    phone: text('phone', ''),
    // An address the brand has not posted stays blank rather than borrowing
    // another shop's: a staff member reading a wrong street would act on it.
    street: address?.street?.trim() || '',
    cityLine,
    website: text('website', ''),
    giftCodePrefix: text('giftCodePrefix', monogramOf(name)),
    monogram: text('monogram', monogramOf(name)),
    // A wrong zone silently shifts every pickup window and calendar entry, so
    // fall back to the device's rather than to another shop's.
    timezone: location?.timezone?.trim()
      || Intl.DateTimeFormat().resolvedOptions().timeZone
      || BUSINESS.timezone,
  };
}

/** Demo mode is Coffee Story's shop; live mode is whoever signed in. */
export function resolveBusiness(input: {
  isDemo: boolean;
  brandConfig: unknown;
  brandName: string | null;
  location: BusinessLocationSource;
}): BusinessDetails {
  return input.isDemo
    ? DEMO_BUSINESS
    : businessFromBrandConfig(input.brandConfig, input.brandName, input.location);
}

/**
 * The resolved shop for the plain, non-React helpers.
 *
 * `openWebPath` and friends are called from module-level functions that cannot
 * hold a hook, so AuthProvider publishes the resolved shop here as it loads
 * (one writer, everywhere else reads). Components use `useBusiness()` instead,
 * which re-renders when the value lands; this is a last-read snapshot.
 */
let current: BusinessDetails = DEMO_BUSINESS;

export function setCurrentBusiness(next: BusinessDetails): void {
  current = next;
}

export function currentBusiness(): BusinessDetails {
  return current;
}
