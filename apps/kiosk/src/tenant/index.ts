/**
 * The tenant this kiosk binary is built for.
 *
 * A thin, hand-written view over `src/tenants/` -- the generated barrel that
 * statically imports every applied tenant and selects one from
 * `EXPO_PUBLIC_TENANT` at module load. A dozen modules used to import the brand
 * file directly, as a JSON module, against one shared checked-in copy that
 * `pnpm onboard --apply` overwrote -- so applying a second brand deleted the
 * first brand's build inputs. Those import sites now come through here.
 *
 * `tenant.test.ts` fails the build if any applied copy drifts from its tenant
 * folder.
 */
import { APPLIED_TENANT_SLUGS, TENANT_SLOT, TENANT_SLUG } from '../tenants';

export { APPLIED_TENANT_SLUGS, TENANT_SLUG };

/**
 * The brand file, in the shape the kiosk's screens read it.
 *
 * Loosely typed on purpose, matching the JSON import it replaces: the kiosk
 * reads `identity`, `tokens`, `business`, `features` and `kiosk` off it, and
 * the resolvers in `@platform/domain` validate what they are handed.
 */
type KioskTenantFile = {
  identity: {
    slug: string;
    name: string;
    kioskBundleId: string;
    kioskScheme: string;
    kioskEasProjectId: string;
  };
  tokens?: Record<string, string>;
  copy: Record<string, string>;
  features: Record<string, boolean>;
  business: { monogram: string; legalName?: string; tagline?: string };
  /** Absent is valid: the flow resolver derives a first screen from the menu. */
  kiosk?: Record<string, unknown>;
};

export const TENANT: KioskTenantFile = TENANT_SLOT.brand as KioskTenantFile;

/**
 * The same file under the name the boot path and ThemeProvider use.
 *
 * Two names for one object because the modules that read it split that way
 * historically; both resolve to the selected tenant, so they cannot disagree.
 */
export const TENANT_BRAND_CONFIG: KioskTenantFile = TENANT;

/** The installed-module manifest, for `./capabilities`. */
export const TENANT_MODULES: unknown = TENANT_SLOT.modules;
