import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  consoleSectionForPath,
  consoleSectionsFor,
  type ConsoleNavigationAccess,
} from './console-navigation';

const STAFF_ACCESS: ConsoleNavigationAccess = {
  menuHref: '/menu',
  canManageTraining: false,
  canManagePlatform: false,
  canManageBrand: false,
  canViewAnalytics: false,
  canViewIntegrations: false,
  canManageOperations: false,
};

const FULL_ACCESS: ConsoleNavigationAccess = {
  menuHref: '/catalog',
  canManageTraining: true,
  canManagePlatform: true,
  canManageBrand: true,
  canViewAnalytics: true,
  canViewIntegrations: true,
  canManageOperations: true,
};

function destinationsFor(access: ConsoleNavigationAccess): string[] {
  return consoleSectionsFor(access).flatMap((section) => section.items.map((item) => item.href));
}

describe('consoleSectionsFor', () => {
  it('accounts for every legacy console tab exactly once with full access', () => {
    const destinations = destinationsFor(FULL_ACCESS);

    assert.deepEqual(destinations, [
      '/',
      '/locations',
      '/apps',
      '/apps/customer',
      '/apps/operator',
      '/apps/kiosk',
      '/apps/display',
      '/catalog',
      '/menu/import',
      '/kiosk',
      '/storage',
      '/training',
      '/drops',
      '/campaigns',
      '/customers',
      '/operations',
      '/operations/templates',
      '/operations/schedules',
      '/operations/history',
      '/operations/reporting',
      '/operations/retention',
      '/analytics',
      '/analytics/apps',
      '/analytics/commerce',
      '/analytics/operations',
      '/analytics/training',
      '/analytics/growth',
      '/analytics/reliability',
      '/integrations',
      '/integrations/connected',
      '/integrations/activity',
      '/integrations/health',
      '/brand',
      '/staff',
      '/fees',
      '/onboarding',
    ]);
    assert.equal(new Set(destinations).size, destinations.length);
  });

  it('keeps all unrestricted tabs visible to staff and omits privileged tabs', () => {
    assert.deepEqual(destinationsFor(STAFF_ACCESS), [
      '/',
      '/locations',
      '/apps',
      '/apps/customer',
      '/apps/operator',
      '/apps/kiosk',
      '/apps/display',
      '/menu',
      '/drops',
      '/campaigns',
      '/customers',
    ]);
  });

  it('places every destination in a unique section with a valid section home', () => {
    const sections = consoleSectionsFor(FULL_ACCESS);
    const sectionKeys = sections.map((section) => section.key);

    assert.equal(new Set(sectionKeys).size, sectionKeys.length);
    for (const section of sections) {
      assert.ok(section.items.some((item) => item.href === section.home));
    }
  });

  it('resolves every tab and nested route to its owning first-rail section', () => {
    const sections = consoleSectionsFor(FULL_ACCESS);

    for (const section of sections) {
      for (const item of section.items) {
        assert.equal(consoleSectionForPath(sections, item.href)?.key, section.key);
      }
    }
    assert.equal(consoleSectionForPath(sections, '/apps/customer/orders')?.key, 'apps');
    assert.equal(consoleSectionForPath(sections, '/wall/preview/store-1'), undefined);
    assert.equal(consoleSectionForPath(sections, '/not-a-console-tab'), undefined);
  });

  it('preserves the correct hierarchy for manager and owner access', () => {
    const managerDestinations = destinationsFor({
      ...STAFF_ACCESS,
      canManageTraining: true,
      canViewAnalytics: true,
      canViewIntegrations: true,
    });
    const ownerDestinations = destinationsFor({
      ...FULL_ACCESS,
      canManagePlatform: false,
    });

    assert.ok(managerDestinations.includes('/training'));
    assert.equal(managerDestinations.includes('/brand'), false);
    assert.ok(ownerDestinations.includes('/catalog'));
    assert.ok(ownerDestinations.includes('/kiosk'));
    assert.ok(ownerDestinations.includes('/brand'));
    assert.ok(ownerDestinations.includes('/staff'));
    assert.equal(ownerDestinations.includes('/fees'), false);
    assert.equal(ownerDestinations.includes('/onboarding'), false);
  });
});
