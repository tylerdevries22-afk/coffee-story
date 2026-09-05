import coffeeStoryBrand from '../../../tenants/coffee-story/brand.json';
import stillpointBrand from '../../../tenants/stillpoint-builders/brand.json';
import stillpointOperations from '../../../tenants/stillpoint-builders/operations.json';
import { resolveActivityBoardConfig, type ActivityBoardConfig } from '@platform/domain';
import type { ActivityBoardItemRow } from '@platform/schema';

import { DEMO_BRAND_CONFIG, demoLocationName } from './demo-board';

type Template = {
  title: string; requiredRoleKeys: string[];
};

const roleNames = new Map(stillpointOperations.roles.map((role) => [role.key, role.title]));
const ACTORS = [null, null, 'Luis Ortega', 'Avery Stone', 'Nina Patel', 'Eli Brooks'];
const IDS = [
  '20000000-0000-4000-8000-000000000110',
  '20000000-0000-4000-8000-000000000111',
  '20000000-0000-4000-8000-000000000112',
  '20000000-0000-4000-8000-000000000113',
  '20000000-0000-4000-8000-000000000114',
  '20000000-0000-4000-8000-000000000115',
] as const;

function neutralBrandConfig(slug: string): unknown {
  return {
    identity: { slug, name: 'Base App' },
    business: { industry: 'General' },
    copy: { appName: 'Base App' },
  };
}

export type DemoTenantKind = 'default' | 'activity' | 'neutral';

export function selectedDemoTenantKind(slug = process.env.TENANT): DemoTenantKind {
  const selected = slug?.trim();
  if (!selected || selected === coffeeStoryBrand.identity.slug) return 'default';
  return selected === stillpointBrand.identity.slug ? 'activity' : 'neutral';
}

export function selectedDemoBrandConfig(slug = process.env.TENANT): unknown {
  const selected = slug?.trim();
  const kind = selectedDemoTenantKind(selected);
  if (kind === 'default') return DEMO_BRAND_CONFIG;
  if (kind === 'activity') return stillpointBrand;
  return neutralBrandConfig(selected ?? 'base-app');
}

export type DemoDisplayPresentation = {
  activityConfig: ActivityBoardConfig;
  tenantName: string;
};

/** Derives route-level display copy from the same selected tenant manifest as the board. */
export function selectedDemoDisplayPresentation(
  slug = process.env.TENANT,
): DemoDisplayPresentation {
  const brandConfig = selectedDemoBrandConfig(slug);
  const identity = (brandConfig as { identity?: { name?: unknown } }).identity;
  return {
    activityConfig: resolveActivityBoardConfig(brandConfig),
    tenantName: typeof identity?.name === 'string' ? identity.name.trim() : '',
  };
}

export function selectedDemoLocationName(locationId: string, slug = process.env.TENANT): string {
  const selected = slug?.trim();
  if (!selected || selected === coffeeStoryBrand.identity.slug) return demoLocationName(locationId);
  if (selected === stillpointBrand.identity.slug) {
    return stillpointBrand.locations[0]?.name ?? 'Main';
  }
  return 'Main';
}

export function demoActivityItems(now: number, locationId: string): ActivityBoardItemRow[] {
  const templates = stillpointOperations.templates as Template[];
  return templates.map((template, index) => {
    const status = index < 2 ? 'scheduled' : index < 4 ? 'claimed' : 'completed';
    return {
      id: IDS[index] ?? IDS[0], brand_id: 'stillpoint-demo', location_id: locationId,
      title: template.title,
      audience_labels: template.requiredRoleKeys.map((key) => roleNames.get(key) ?? 'Field team'),
      status, scheduled_for: new Date(now + (index - 3) * 18 * 60_000).toISOString(),
      due_at: new Date(now + (index - 1) * 25 * 60_000).toISOString(),
      actor_name: ACTORS[index] ?? null, updated_at: new Date(now - index * 90_000).toISOString(),
    };
  });
}
