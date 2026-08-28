import type { IconName } from '@/components/icon';

import { pathMatchesHref } from './navigation-path';

export type ConsoleNavItem = {
  readonly href: string;
  readonly label: string;
  readonly icon: IconName;
};

export type ConsoleSection = {
  readonly key: string;
  readonly title: string;
  readonly icon: IconName;
  readonly items: readonly ConsoleNavItem[];
  readonly home: string;
};

export type ConsoleNavigationAccess = {
  readonly menuHref: '/catalog' | '/menu';
  readonly canManageTraining: boolean;
  readonly canManagePlatform: boolean;
  readonly canManageBrand: boolean;
  readonly canViewAnalytics: boolean;
  readonly canViewIntegrations: boolean;
  readonly canManageOperations: boolean;
};

const DASHBOARD_SECTION = {
  key: 'dashboard',
  title: 'Dashboard',
  icon: 'dashboard',
  home: '/',
  items: [
    { href: '/', label: 'Overview', icon: 'dashboard' },
    { href: '/locations', label: 'Locations', icon: 'locations' },
    { href: '/wall', label: 'Live wall', icon: 'wall' },
  ],
} satisfies ConsoleSection;

const DROPS_SECTION = {
  key: 'drops',
  title: 'Drops',
  icon: 'drop',
  home: '/drops',
  items: [{ href: '/drops', label: 'Overview', icon: 'drop' }],
} satisfies ConsoleSection;

const CAMPAIGNS_SECTION = {
  key: 'campaigns',
  title: 'Campaigns',
  icon: 'campaign',
  home: '/campaigns',
  items: [{ href: '/campaigns', label: 'Overview', icon: 'campaign' }],
} satisfies ConsoleSection;

const CUSTOMERS_SECTION = {
  key: 'customers',
  title: 'Customers',
  icon: 'users',
  home: '/customers',
  items: [{ href: '/customers', label: 'Directory', icon: 'users' }],
} satisfies ConsoleSection;

const ANALYTICS_SECTION = {
  key: 'analytics',
  title: 'Analytics',
  icon: 'analytics',
  home: '/analytics',
  items: [
    { href: '/analytics', label: 'Overview', icon: 'dashboard' },
    { href: '/analytics/apps', label: 'Apps', icon: 'kiosk' },
    { href: '/analytics/commerce', label: 'Commerce', icon: 'drop' },
    { href: '/analytics/operations', label: 'Operations', icon: 'locations' },
    { href: '/analytics/training', label: 'Training', icon: 'training' },
    { href: '/analytics/growth', label: 'Growth', icon: 'campaign' },
    { href: '/analytics/reliability', label: 'Reliability', icon: 'activity' },
  ],
} satisfies ConsoleSection;

const INTEGRATIONS_SECTION = {
  key: 'integrations',
  title: 'Integrations',
  icon: 'integrations',
  home: '/integrations',
  items: [
    { href: '/integrations', label: 'Catalog', icon: 'integrations' },
    { href: '/integrations/connected', label: 'Connected', icon: 'activity' },
    { href: '/integrations/activity', label: 'Activity', icon: 'analytics' },
    { href: '/integrations/health', label: 'Health', icon: 'help' },
  ],
} satisfies ConsoleSection;

const OPERATIONS_SECTION = {
  key: 'operations',
  title: 'Operations',
  icon: 'locations',
  home: '/operations',
  items: [
    { href: '/operations', label: 'Live board', icon: 'wall' },
    { href: '/operations/templates', label: 'Templates', icon: 'menu' },
    { href: '/operations/schedules', label: 'Schedules', icon: 'locations' },
    { href: '/operations/history', label: 'History', icon: 'activity' },
    { href: '/operations/reporting', label: 'Reporting', icon: 'analytics' },
    { href: '/operations/retention', label: 'Retention', icon: 'settings' },
  ],
} satisfies ConsoleSection;

function contentSection(access: ConsoleNavigationAccess): ConsoleSection {
  return {
    key: 'content',
    title: 'Content',
    icon: 'menu',
    home: access.menuHref,
    items: [
      { href: access.menuHref, label: access.menuHref === '/catalog' ? 'Catalog' : 'Menu', icon: 'menu' },
      ...(access.canManageBrand
        ? [{ href: '/kiosk', label: 'Kiosk', icon: 'kiosk' as const }]
        : []),
      ...(access.canManageTraining
        ? [{ href: '/training', label: 'Training', icon: 'training' as const }]
        : []),
    ],
  };
}

function settingsSection(access: ConsoleNavigationAccess): ConsoleSection {
  const items: ConsoleNavItem[] = [
    ...(access.canManageBrand
      ? [{ href: '/brand', label: 'Brand config', icon: 'brand' as const }]
      : []),
    ...(access.canManagePlatform
      ? [{ href: '/fees', label: 'Platform fees', icon: 'settings' as const }]
      : []),
    ...(access.canManagePlatform
      ? [{ href: '/onboarding', label: 'Onboarding', icon: 'onboarding' as const }]
      : []),
  ];
  return {
    key: 'settings',
    title: 'Settings',
    icon: 'settings',
    home: items[0]?.href ?? '/brand',
    items,
  };
}

/** Returns every console destination available to the current role, grouped once. */
export function consoleSectionsFor(access: ConsoleNavigationAccess): ConsoleSection[] {
  return [
    DASHBOARD_SECTION,
    contentSection(access),
    DROPS_SECTION,
    CAMPAIGNS_SECTION,
    CUSTOMERS_SECTION,
    ...(access.canManageOperations ? [OPERATIONS_SECTION] : []),
    ...(access.canViewAnalytics ? [ANALYTICS_SECTION] : []),
    ...(access.canViewIntegrations ? [INTEGRATIONS_SECTION] : []),
    settingsSection(access),
  ].filter((section) => section.items.length > 0);
}

/** Resolves a pathname to its single owning rail section. */
export function consoleSectionForPath(
  sections: readonly ConsoleSection[],
  pathname: string,
): ConsoleSection | undefined {
  return sections.find((section) =>
    section.items.some((item) => pathMatchesHref(pathname, item.href)),
  );
}
