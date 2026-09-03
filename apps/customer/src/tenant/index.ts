/**
 * The tenant this binary is built for.
 *
 * `brand.json` here is a build-time copy of `tenants/<slug>/brand.json`,
 * refreshed by `pnpm onboard --tenant <slug>` -- Metro cannot require a path
 * chosen at runtime, so the onboarding step materialises the choice.
 * `tenant.test.ts` fails the build if the copy drifts from the source tree.
 */
import { REWARD_TIERS, resolveRewardTiers, type RewardTier } from '@platform/domain';
import {
  installedModuleKeys,
  storefrontCapabilitiesOf,
  type StorefrontCapability,
} from '@platform/module-kit';

import brandJson from './brand.json';
import modulesJson from './modules.json';

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
  /**
   * The shop's sales-tax authorities. The bundled brand.json has always carried
   * these; only this type omitted them, which is why every screen fell back to
   * a Colorado default that lived in packages/domain.
   */
  tax?: { jurisdictions: { id: string; label: string; rate: number }[] };
  /** The earning ladder. Absent or unparseable means the shipped generic one. */
  loyalty?: { tiers?: unknown };
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

/**
 * The modules installed for this tenant, from the bundled manifest.
 *
 * Bundled and not fetched, deliberately. This app is offline-first: a cold
 * boot in a basement with no signal has to resolve capability from something,
 * and resolving it from the network means resolving it to nothing -- which
 * renders an app with no drops, no catering and no gift balance. The manifest
 * is refreshed by `pnpm onboard --apply` and pinned to the tenant folder by
 * tenant.test.ts, so it moves when the tenant moves.
 *
 * `public.brand_storefront_capabilities` is the server's answer to the same
 * question and is used as a revalidation and drift check (lib/capability-check)
 * rather than as the boot source. Nothing here authorizes a write: every write
 * behind these flags is re-authorized server side under RLS.
 */
export const TENANT_MODULE_KEYS: readonly string[] = installedModuleKeys(modulesJson);

const TENANT_CAPABILITIES = storefrontCapabilitiesOf(TENANT_MODULE_KEYS);

/**
 * Whether this tenant runs a storefront capability.
 *
 * Narrower than `TenantFeatures` on purpose: `multi_location` and `sms` are a
 * capacity setting and an integration setting on the brands row, not
 * capabilities, so they have no module to resolve against and no screen
 * branches on them.
 */
export function tenantFeature(flag: StorefrontCapability): boolean {
  return TENANT_CAPABILITIES[flag];
}

/**
 * The tenant's tax authorities, for the screens that render a breakdown.
 *
 * Empty for a tenant that has not declared any -- which renders no tax rows and
 * charges no tax on screen, rather than quietly showing another shop's. The
 * server is the authority either way: it recomputes every cent from
 * `brand_config` and the app renders what comes back.
 */
export const TENANT_TAX_JURISDICTIONS: readonly { id: string; label: string; rate: number }[] =
  TENANT.tax?.jurisdictions ?? [];

/**
 * The tenant's loyalty ladder, for the rewards, checkout and gift surfaces.
 *
 * Falls back to the shipped generic rungs when the tenant has not written a
 * ladder -- unlike tax, a guest with no tier is not a coherent screen, and the
 * shipped rungs name no shop. The server is still the authority on what was
 * actually earned; this is what the app draws while it waits.
 */
export const TENANT_REWARD_TIERS: readonly RewardTier[] =
  resolveRewardTiers(brandJson) ?? REWARD_TIERS;
