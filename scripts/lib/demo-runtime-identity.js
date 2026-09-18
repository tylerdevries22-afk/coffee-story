const { join } = require('node:path');

const { DEMO_NEUTRAL_TENANT, demoRuntimeEnabled } = require('./tenant-bundle-resolver');

/**
 * What an Expo config needs to know about demo runtime mode, in one place:
 * app.config.ts for both guest apps read this instead of each re-declaring
 * the neutral tenant's slug and the conflict check, which is what actually
 * hard-coded "juniper-base-demo" in four files at once (this one plus
 * tenant-bundle-resolver.js, which is the single source both read from).
 *
 * Returns null outside demo runtime mode, so the caller's own tenant
 * resolution runs exactly as before. Throws, rather than returning, on a
 * stray tenant var: a production tenant build must never become a demo
 * runtime build, or the reverse, and there is no path resolveAppliedTenant
 * could fall back to. See tenant-bundle-resolver.js's tenantBundlePath and
 * both apps' tenants/selected.ts for the same check at the other two layers
 * a build or bundle could otherwise take the wrong branch.
 */
function demoRuntimeBrandPath(appDirectory, app) {
  if (!demoRuntimeEnabled()) return null;
  const named = process.env.EXPO_PUBLIC_TENANT?.trim() || process.env.TENANT?.trim();
  if (named) {
    throw new Error(
      `EXPO_PUBLIC_DEMO_RUNTIME=1 and a named tenant ("${named}") cannot both be set for apps/${app}. `
      + 'Unset EXPO_PUBLIC_TENANT/TENANT for a demo runtime build, or unset EXPO_PUBLIC_DEMO_RUNTIME for a tenant build.',
    );
  }
  return join(appDirectory, 'src', 'tenants', DEMO_NEUTRAL_TENANT, 'brand.json');
}

module.exports = { demoRuntimeBrandPath };
