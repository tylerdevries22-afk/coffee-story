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
};

const FULL_ACCESS: ConsoleNavigationAccess = {
  menuHref: '/catalog',
  canManageTraining: true,
  canManagePlatform: true,
  canManageBrand: true,
  canViewAnalytics: true,
  canViewIntegrations: true,
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
      '/wall',
      '/catalog',
      '/kiosk',
      '/training',
      '/drops',
      '/campaigns',
      '/customers',
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
      '/fees',
      '/onboarding',
    ]);
    assert.equal(new Set(destinations).size, destinations.length);
  });

  it('keeps all unrestricted tabs visible to staff and omits privileged tabs', () => {
    assert.deepEqual(destinationsFor(STAFF_ACCESS), [
      '/',
      '/locations',
      '/wall',
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
    assert.equal(consoleSectionForPath(sections, '/wall/preview/store-1')?.key, 'dashboard');
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
    assert.equal(ownerDestinations.includes('/fees'), false);
    assert.equal(ownerDestinations.includes('/onboarding'), false);
  });
});
