/**
 * The console's destinations, as data.
 *
 * Split out of console-navigation so that file holds only the assembly rule --
 * which sections a given access set may see -- and this one holds only what
 * there is to see. The two changed for different reasons and at different
 * rates, and reading either meant scrolling past the other.
 */
import type { ConsoleNavItem, ConsoleNavigationAccess, ConsoleSection } from './console-navigation';

export const DASHBOARD_SECTION = {
  key: 'dashboard',
  title: 'Dashboard',
  icon: 'dashboard',
  home: '/',
  items: [
    { href: '/', label: 'Overview', icon: 'dashboard' },
    { href: '/locations', label: 'Locations', icon: 'locations' },
  ],
} satisfies ConsoleSection;

export const APPS_SECTION = {
  key: 'apps',
  title: 'Apps',
  icon: 'panel',
  home: '/apps',
  items: [
    { href: '/apps', label: 'Wall', icon: 'wall' },
    { href: '/apps/customer', label: 'Customer', icon: 'users' },
    { href: '/apps/operator', label: 'Operator', icon: 'activity' },
    { href: '/apps/kiosk', label: 'Kiosk / POS', icon: 'kiosk' },
    { href: '/apps/display', label: 'Pickup display', icon: 'wall' },
  ],
} satisfies ConsoleSection;

export const DROPS_SECTION = {
  key: 'drops',
  title: 'Drops',
  icon: 'drop',
  home: '/drops',
  items: [{ href: '/drops', label: 'Overview', icon: 'drop' }],
} satisfies ConsoleSection;

export const CAMPAIGNS_SECTION = {
  key: 'campaigns',
  title: 'Campaigns',
  icon: 'campaign',
  home: '/campaigns',
  items: [{ href: '/campaigns', label: 'Overview', icon: 'campaign' }],
} satisfies ConsoleSection;

export const CUSTOMERS_SECTION = {
  key: 'customers',
  title: 'Customers',
  icon: 'users',
  home: '/customers',
  items: [{ href: '/customers', label: 'Directory', icon: 'users' }],
} satisfies ConsoleSection;

/**
 * `/analytics/operations` reports on the operations module and nothing else,
 * so it belongs to the same capability as the section that runs it. Under
 * `canViewAnalytics` alone it offered every manager a report on a module their
 * brand may never have installed -- an empty page that reads as a broken one.
 */
export function analyticsSection(access: ConsoleNavigationAccess): ConsoleSection {
  return {
    key: 'analytics',
    title: 'Analytics',
    icon: 'analytics',
    home: '/analytics',
    items: [
      { href: '/analytics', label: 'Overview', icon: 'dashboard' },
      { href: '/analytics/apps', label: 'Apps', icon: 'kiosk' },
      { href: '/analytics/commerce', label: 'Commerce', icon: 'drop' },
      ...(access.canManageOperations
        ? [{ href: '/analytics/operations', label: 'Operations', icon: 'locations' as const }]
        : []),
      { href: '/analytics/training', label: 'Training', icon: 'training' },
      { href: '/analytics/growth', label: 'Growth', icon: 'campaign' },
      { href: '/analytics/reliability', label: 'Reliability', icon: 'activity' },
    ],
  };
}

export const INTEGRATIONS_SECTION = {
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

export const OPERATIONS_SECTION = {
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

export function contentSection(access: ConsoleNavigationAccess): ConsoleSection {
  return {
    key: 'content',
    title: 'Content',
    icon: 'menu',
    home: access.menuHref,
    items: [
      { href: access.menuHref, label: access.menuHref === '/catalog' ? 'Catalog' : 'Menu', icon: 'menu' },
      ...(access.canManageBrand
        ? [{ href: '/menu/import', label: 'Import CSV', icon: 'menu' as const }]
        : []),
      ...(access.canManageBrand
        ? [{ href: '/kiosk', label: 'Kiosk', icon: 'kiosk' as const }]
        : []),
      ...(access.canManageBrand
        ? [{ href: '/storage', label: 'Storage', icon: 'folder' as const }]
        : []),
      ...(access.canManageTraining
        ? [{ href: '/training', label: 'Training', icon: 'training' as const }]
        : []),
    ],
  };
}

export function settingsSection(access: ConsoleNavigationAccess): ConsoleSection {
  const items: ConsoleNavItem[] = [
    ...(access.canManageBrand
      ? [{ href: '/brand', label: 'Brand config', icon: 'brand' as const }]
      : []),
    ...(access.canManageBrand
      ? [{ href: '/staff', label: 'Staff access', icon: 'users' as const }]
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
