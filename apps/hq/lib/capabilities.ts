/**
 * What the selected brand may actually do, read from `module_installations`.
 *
 * The console used to ask `brands.operations` and `brand_config.features` --
 * two boolean surfaces nothing else in the platform agreed with. Installations
 * are the authorization root as of 20260903170000, so this is the one place the
 * console asks, and every gated read goes through it.
 */
import { cache } from 'react';

import { serverClient } from './supabase-server';

/**
 * What preview resolves to.
 *
 * Not a grant and never consulted by a configured deployment: it is the
 * fixture that makes the console reviewable with no database, in the same
 * spirit as DEMO_SESSION. Deliberately not "every module the platform ships" --
 * a preview that shows sections no tenant has installed is a demo of the
 * catalog rather than of the product -- so it mirrors the launch tenant's own
 * manifest (tenants/coffee-story/modules.json).
 */
export const DEMO_MODULE_KEYS: readonly string[] = [
  'commerce-catalog',
  'commerce-catering',
  'commerce-delivery',
  'commerce-ordering',
  'device-wall',
  'growth-drops',
  'growth-referrals',
  'growth-stored-value',
  'workforce-operations',
];

/**
 * The single read this module makes, as a function so a test can supply it.
 *
 * `null` data with no error cannot happen on this path -- PostgREST returns a
 * row array or an error -- but the type admits it, so the resolver treats it
 * the way it treats every other absent answer from a configured deployment.
 */
export type ModuleInstallationReader = (
  brandId: string,
) => Promise<{ data: { module_key: string }[] | null; error: unknown }>;

/**
 * Resolve installed capability, with the two cases kept apart on purpose.
 *
 * There is no client when `isConfigured()` is false -- no Supabase env, or the
 * preview wall -- and that is demo/fixture mode, not a denied request. It
 * resolves to the demo set, because a preview with every section hidden is not
 * a preview of anything.
 *
 * A configured deployment that asked and did not get an answer is the other
 * case entirely, and the only one that is a security decision: the read failed,
 * so nothing is granted. Collapsing the two into one falsy check is how a
 * transient error becomes a fully-featured console.
 */
export async function resolveModuleKeys(
  reader: ModuleInstallationReader | null,
  brandId: string | null,
): Promise<ReadonlySet<string>> {
  // Case 1 -- demo/fixture mode. No database was asked, so nothing was denied.
  if (reader === null) return new Set(DEMO_MODULE_KEYS);

  // Case 2 -- configured. From here every failure denies.
  if (brandId === null) return new Set();
  const { data, error } = await reader(brandId);
  if (error || !data) return new Set();
  return new Set(data.map((row) => row.module_key));
}

/**
 * The active module keys of one brand, resolved once per request.
 *
 * React `cache` and not a module-level map: this is request-scoped, so two
 * tenants rendering concurrently cannot see each other's answer, and the entry
 * dies with the request rather than serving a revoked module until a restart.
 *
 * Memoization is load-bearing rather than a nicety. Around forty-six console
 * pages gate a nav section, a page section and a body from the same fact; one
 * query per gated read is one query per fact per render.
 */
export const activeModuleKeys = cache(
  async (brandId: string | null): Promise<ReadonlySet<string>> => {
    const client = await serverClient();
    if (!client) return resolveModuleKeys(null, brandId);
    return resolveModuleKeys(
      async (id) => client
        .from('module_installations')
        .select('module_key')
        .eq('brand_id', id)
        .eq('state', 'active')
        .returns<{ module_key: string }[]>(),
      brandId,
    );
  },
);

/**
 * Whether a brand may run more than one site.
 *
 * Not a module, and deliberately so: LEGACY_FLAG_MODULE_MAP leaves
 * `multi_location` unmapped because how many sites a tenant runs is a capacity
 * setting on the brands row, not a capability. It is resolved here anyway so
 * the two-case rule is stated once and every caller inherits it.
 */
export const DEMO_MULTI_LOCATION = true;

/** The console capabilities the nav and the page bodies gate on. */
export type ConsoleCapabilities = {
  readonly operations: boolean;
  readonly drops: boolean;
  readonly growth: boolean;
};

/**
 * Campaigns has no module of its own in MODULE_REGISTRY, and inventing one
 * here would hide the section from every tenant on the commit that added it --
 * no installation names a key the registry has only just learned. What a
 * campaign needs is an audience and an offer, and both come from the growth
 * modules, so the section is gated on having any of them rather than on a key
 * nobody holds. A brand with no growth capability has nobody to campaign to.
 */
const GROWTH_MODULE_KEYS: readonly string[] = [
  'growth-drops',
  'growth-loyalty',
  'growth-referrals',
  'growth-stored-value',
];

export function consoleCapabilitiesOf(moduleKeys: ReadonlySet<string>): ConsoleCapabilities {
  return {
    operations: moduleKeys.has('workforce-operations'),
    drops: moduleKeys.has('growth-drops'),
    growth: GROWTH_MODULE_KEYS.some((key) => moduleKeys.has(key)),
  };
}
