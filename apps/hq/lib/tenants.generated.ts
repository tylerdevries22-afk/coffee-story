/**
 * Every tenant folder under /tenants, as the HQ console's registry reads them.
 *
 * GENERATED from tenants/ by `pnpm hq:tenants`, which `pnpm onboard` also
 * runs. Do not edit: add or remove a tenant folder and regenerate.
 *
 * One literal import per file, because Next resolves imports at build time and
 * cannot follow a computed path. Sorted by slug; the order the switcher shows,
 * and anything else that is a decision rather than a scan, is ./tenants.ts's.
 */
import brandActz from '../../../tenants/actz/brand.json';
import modulesActz from '../../../tenants/actz/modules.json';
import brandCoffeeStory from '../../../tenants/coffee-story/brand.json';
import modulesCoffeeStory from '../../../tenants/coffee-story/modules.json';
import brandJuniperBaseDemo from '../../../tenants/juniper-base-demo/brand.json';
import modulesJuniperBaseDemo from '../../../tenants/juniper-base-demo/modules.json';
import brandStillpointBuilders from '../../../tenants/stillpoint-builders/brand.json';
import modulesStillpointBuilders from '../../../tenants/stillpoint-builders/modules.json';
import brandSummitRidgeHotels from '../../../tenants/summit-ridge-hotels/brand.json';
import modulesSummitRidgeHotels from '../../../tenants/summit-ridge-hotels/modules.json';

/**
 * The fields ./tenants.ts reads by name. Typed here so a tenant whose files
 * lack them fails the console's typecheck instead of rendering a blank org.
 */
export type GeneratedTenant = {
  readonly slug: string;
  readonly brand: { readonly identity: { readonly name: string } };
  readonly modules: {
    readonly modules: readonly { readonly key: string; readonly enabled?: boolean }[];
  };
};

export const GENERATED_TENANTS: readonly GeneratedTenant[] = [
  { slug: 'actz', brand: brandActz, modules: modulesActz },
  { slug: 'coffee-story', brand: brandCoffeeStory, modules: modulesCoffeeStory },
  { slug: 'juniper-base-demo', brand: brandJuniperBaseDemo, modules: modulesJuniperBaseDemo },
  { slug: 'stillpoint-builders', brand: brandStillpointBuilders, modules: modulesStillpointBuilders },
  { slug: 'summit-ridge-hotels', brand: brandSummitRidgeHotels, modules: modulesSummitRidgeHotels },
];
