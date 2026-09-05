import coffeeStoryBrand from '../../../../tenants/coffee-story/brand.json';
import coffeeStoryModules from '../../../../tenants/coffee-story/modules.json';
import stillpointBrand from '../../../../tenants/stillpoint-builders/brand.json';
import stillpointModules from '../../../../tenants/stillpoint-builders/modules.json';

export type DemoTenant = {
  brandConfig: unknown;
  brandName: string;
  locations: readonly { id: string; name: string; timezone: string }[];
  moduleKeys: readonly string[];
};

function enabledModuleKeys(manifest: { modules: { key: string; enabled?: boolean }[] }): string[] {
  return manifest.modules.filter((entry) => entry.enabled !== false).map((entry) => entry.key);
}

const STILLPOINT_LOCATIONS = stillpointBrand.locations.map((location, index) => ({
  id: index === 0 ? 'loc-uptown' : `loc-stillpoint-${index + 1}`,
  name: location.name,
  timezone: location.timezone,
}));

function neutralTenant(slug: string): DemoTenant {
  return {
    brandConfig: {
      identity: { slug, name: 'Base App' },
      business: { industry: 'General' },
      copy: { appName: 'Base App' },
    },
    brandName: 'Base App',
    locations: [{ id: 'loc-base', name: 'Main', timezone: 'UTC' }],
    moduleKeys: [],
  };
}

export function usesLaunchDemoFixtures(slug = process.env.EXPO_PUBLIC_TENANT): boolean {
  const selected = slug?.trim();
  return !selected || selected === coffeeStoryBrand.identity.slug;
}

export function demoOperationsEnabled(slug = process.env.EXPO_PUBLIC_TENANT): boolean {
  if (usesLaunchDemoFixtures(slug)) {
    return enabledModuleKeys(coffeeStoryModules).includes('workforce-operations');
  }
  return selectedDemoTenant(slug)?.moduleKeys.includes('workforce-operations') === true;
}

/** Build-time demo selection only; live tenancy still comes exclusively from login. */
export function selectedDemoTenant(slug = process.env.EXPO_PUBLIC_TENANT): DemoTenant | null {
  const selected = slug?.trim();
  if (!selected || selected === coffeeStoryBrand.identity.slug) return null;
  if (selected === stillpointBrand.identity.slug) {
    return {
      brandConfig: stillpointBrand,
      brandName: stillpointBrand.identity.name,
      locations: STILLPOINT_LOCATIONS,
      moduleKeys: enabledModuleKeys(stillpointModules),
    };
  }
  return neutralTenant(selected);
}

export const SELECTED_DEMO_TENANT = selectedDemoTenant();
