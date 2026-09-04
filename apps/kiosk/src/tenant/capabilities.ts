/**
 * What this kiosk's tenant runs, from the bundled module manifest.
 *
 * Bundled and not fetched, for the reason a counter tablet cares about more
 * than any other surface: a kiosk that lost its uplink is still expected to
 * take orders. Resolving capability from the network would mean a cold boot
 * behind a dead router renders a payment screen with no gift-card tender and a
 * menu with no drops -- "fail closed" producing the outage rather than
 * containing it. `pnpm onboard --apply` refreshes the manifest and
 * tenant.test.ts pins it to the tenant folder.
 *
 * `lib/capability-check` revalidates against the server and caches the answer;
 * it is a drift check, not the boot source.
 */
import {
  installedModuleKeys,
  storefrontCapabilitiesOf,
  type StorefrontCapability,
} from '@platform/module-kit';

import { TENANT_MODULES } from './index';

export const TENANT_MODULE_KEYS: readonly string[] = installedModuleKeys(TENANT_MODULES);

const TENANT_CAPABILITIES = storefrontCapabilitiesOf(TENANT_MODULE_KEYS);

/** Whether this tenant runs a storefront capability the kiosk branches on. */
export function kioskCapability(flag: StorefrontCapability): boolean {
  return TENANT_CAPABILITIES[flag];
}
