/**
 * The shop's own details, derived from the tenant config in one place.
 *
 * They were written out three times and disagreed (see git history); now the
 * single source is `src/tenant/brand.json`, so rebranding the binary for
 * another tenant rebrands every error screen, receipt and calendar note with
 * it (rule 4 applies to words too).
 *
 * Pure -- no asset imports -- so both the app and `node:test` can read it.
 */
import { TENANT } from '@/tenant';

export const BUSINESS = {
  name: TENANT.identity.name,
  legalName: TENANT.business.legalName,
  tagline: TENANT.business.tagline,
  email: TENANT.business.email,
  phone: TENANT.business.phone,
  street: TENANT.location.address.street,
  cityLine: `${TENANT.location.address.city}, ${TENANT.location.address.region} ${TENANT.location.address.postal}`,
  website: TENANT.business.website,
  /** Prefix on every gift-card code the app issues. */
  giftCodePrefix: TENANT.business.giftCodePrefix,
} as const;

export const BUSINESS_ADDRESS = `${BUSINESS.street}, ${BUSINESS.cityLine}`;

/** The 1-3 letter mark the app falls back to when there is no name or photo. */
export const BUSINESS_MONOGRAM = TENANT.business.monogram;
