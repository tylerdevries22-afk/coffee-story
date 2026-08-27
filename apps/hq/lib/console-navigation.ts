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
  readonly description: string;
  readonly items: readonly ConsoleNavItem[];
  readonly home: string;
};

export type ConsoleNavigationAccess = {
  readonly menuHref: '/content' | '/menu';
  readonly canManageTraining: boolean;
  readonly canManagePlatform: boolean;
  readonly canManageBrand: boolean;
};

const OPERATIONS_SECTION = {
  key: 'operations',
  title: 'Operations',
  icon: 'dashboard',
  home: '/',
  description: 'Daily performance, locations, and the live service wall.',
  items: [
    { href: '/', label: 'Overview', icon: 'dashboard' },
    { href: '/locations', label: 'Locations', icon: 'locations' },
    { href: '/wall', label: 'Live wall', icon: 'wall' },
  ],
} satisfies ConsoleSection;

const GROWTH_SECTION = {
  key: 'growth',
  title: 'Growth',
  icon: 'drop',
  home: '/drops',
  description: 'Campaigns, promotions, and customer growth programs.',
  items: [
    { href: '/drops', label: 'Drops', icon: 'drop' },
    { href: '/campaigns', label: 'Campaigns', icon: 'brand' },
    { href: '/customers', label: 'Customers', icon: 'users' },
  ],
} satisfies ConsoleSection;

const INSIGHTS_SECTION = {
  key: 'insights',
  title: 'Insights',
  icon: 'analytics',
  home: '/analytics',
  description: 'Tenant reporting and operational performance.',
  items: [{ href: '/analytics', label: 'Analytics', icon: 'analytics' }],
} satisfies ConsoleSection;

function contentSection(access: ConsoleNavigationAccess): ConsoleSection {
  return {
    key: 'content',
    title: 'Content',
    icon: 'menu',
    home: access.menuHref,
    description: 'Customer menu, operator training, and kiosk presentation.',
    items: [
      { href: access.menuHref, label: 'Menu', icon: 'menu' },
      ...(access.canManageTraining
        ? [{ href: '/training', label: 'Training', icon: 'training' as const }]
        : []),
      ...(access.canManageBrand
        ? [{ href: '/kiosk', label: 'Kiosk', icon: 'kiosk' as const }]
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
    description: 'Tenant configuration and platform administration.',
    items,
  };
}

/** Returns every console destination available to the current role, grouped once. */
export function consoleSectionsFor(access: ConsoleNavigationAccess): ConsoleSection[] {
  return [
    OPERATIONS_SECTION,
    contentSection(access),
    GROWTH_SECTION,
    INSIGHTS_SECTION,
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
