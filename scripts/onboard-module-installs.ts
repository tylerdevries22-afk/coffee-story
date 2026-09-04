import type { SupabaseClient } from '@supabase/supabase-js';

import { legacyFlagInstallations } from '../packages/module-kit/src/registry.js';

/**
 * Install the modules a tenant's feature flags imply.
 *
 * `20260902220257` backfilled a `module_installations` row for every brand whose
 * legacy flag was true *at migration time*, and registered a readiness assertion
 * that the two stay in step. Nothing did the same for a brand created later --
 * which is every franchise onboarded from here on. Such a brand gets its flags
 * from `brand.json` and no installations, and the release gate then raises
 * `legacy <flag> flag is not fully backfilled`.
 *
 * So this is not bookkeeping: without it, onboarding a new location is what
 * makes the platform unreleasable, and it does so long after the command that
 * caused it has reported success.
 *
 * `module_installations` is the authorization root, so this does not write it.
 * It calls `public.install_brand_module`, the service-role front door added in
 * `20260904030000`, which delegates to the guarded writer and leaves the same
 * audit trail a console operator would. That function is idempotent and returns
 * an existing installation untouched, so re-running onboarding never reactivates
 * a module an operator deliberately suspended.
 */
export async function installTenantModules(
  db: SupabaseClient,
  brandId: string,
  features: Record<string, boolean>,
): Promise<string[]> {
  const moduleKeys = legacyFlagInstallations(features);
  for (const moduleKey of moduleKeys) {
    const installed = await db.rpc('install_brand_module', {
      p_brand_id: brandId,
      p_module_key: moduleKey,
    });
    if (installed.error) {
      throw new Error(`Could not install ${moduleKey}: ${installed.error.message}`);
    }
  }
  return moduleKeys;
}
