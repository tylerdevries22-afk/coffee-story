/**
 * The shop's own details, in one place.
 *
 * They were written out three times and disagreed: `features/more/
 * information-pages.ts` carried the real Aurora shop, while
 * `features/admin/admin-settings.ts` still carried the massage studio's
 * Greenwood Village address, phone and a `coffeestoryhealingoasis.com` email
 * that is a mashup of the two brands. A guest reading Location and a staff
 * member reading Settings saw two different businesses.
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
};

/**
 * Tenancy is by login (rule 7): a signed-in operator's shop details come
 * from the brand row's config, with the bundled shop as the demo fallback.
 * The white-label sweep migrates the static BUSINESS call sites onto this.
 */
export function businessFromBrandConfig(brandConfig: unknown): BusinessDetails {
  const configured = (brandConfig as { business?: Record<string, unknown> } | null)?.business ?? {};
  const text = (key: string, fallback: string): string => {
    const value = configured[key];
    return typeof value === 'string' && value.length > 0 ? value : fallback;
  };
  return {
    name: text('name', BUSINESS.name),
    legalName: text('legalName', BUSINESS.legalName),
    tagline: text('tagline', BUSINESS.tagline),
    email: text('email', BUSINESS.email),
    phone: text('phone', BUSINESS.phone),
    street: text('street', BUSINESS.street),
    cityLine: text('cityLine', BUSINESS.cityLine),
    website: text('website', BUSINESS.website),
    giftCodePrefix: text('giftCodePrefix', BUSINESS.giftCodePrefix),
  };
}
