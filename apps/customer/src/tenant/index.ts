/**
 * The tenant this binary is built for.
 *
 * `brand.json` here is a build-time copy of `tenants/<slug>/brand.json`,
 * refreshed by `pnpm onboard --tenant <slug>` -- Metro cannot require a path
 * chosen at runtime, so the onboarding step materialises the choice.
 * `tenant.test.ts` fails the build if the copy drifts from the source tree.
 */
import brandJson from './brand.json';

export type TenantBusiness = {
  legalName: string;
  tagline: string;
  email: string;
  phone: string;
  website: string;
  giftCodePrefix: string;
  monogram: string;
};

export type TenantFeatures = {
  drops: boolean;
  catering: boolean;
  delivery: boolean;
  multi_location: boolean;
  sms: boolean;
  stored_value: boolean;
  referrals: boolean;
};

type TenantFile = {
  identity: { slug: string; name: string; bundleId: string; scheme: string; easProjectId: string };
  tokens: Record<string, unknown>;
  copy: Record<string, string>;
  features: TenantFeatures;
  business: TenantBusiness;
  location: {
    name: string;
    address: { street: string; city: string; region: string; postal: string };
    timezone: string;
    hours: Record<string, { open: string; close: string }[]>;
  };
};

export const TENANT = brandJson as unknown as TenantFile;

/** The whole file, in the shape ThemeProvider hydrates from. */
export const TENANT_BRAND_CONFIG: unknown = brandJson;

export function tenantFeature(flag: keyof TenantFeatures): boolean {
  return Boolean(TENANT.features?.[flag]);
}
