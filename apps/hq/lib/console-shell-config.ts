import type { ConsoleSection } from './console-navigation';

const PAGE_TITLES: Readonly<Record<string, string>> = {
  '/': 'Overview',
  '/locations': 'Locations',
  '/staff': 'Staff access',
  '/locations/new': 'Add location',
  '/organizations/new': 'Create organization',
  '/menu': 'Menu',
  '/menu/import': 'Import menu',
  '/catalog': 'Catalog',
  '/content': 'Catalog',
  '/fees': 'Platform fees',
  '/training': 'Training',
  '/operations': 'Live operations',
  '/operations/templates': 'Operation templates',
  '/operations/schedules': 'Operation schedules',
  '/operations/history': 'Operation history',
  '/operations/reporting': 'Operation reporting',
  '/operations/retention': 'Operation retention',
  '/drops': 'Drops',
  '/campaigns': 'Campaigns',
  '/customers': 'Customers',
  '/analytics': 'Analytics',
  '/analytics/apps': 'App usage',
  '/analytics/commerce': 'Commerce analytics',
  '/analytics/operations': 'Operations analytics',
  '/analytics/training': 'Training analytics',
  '/analytics/growth': 'Growth analytics',
  '/analytics/reliability': 'Reliability analytics',
  '/integrations': 'Integration catalog',
  '/integrations/connected': 'Connected integrations',
  '/integrations/activity': 'Integration activity',
  '/integrations/health': 'Integration health',
  '/brand': 'Brand config',
  '/kiosk': 'Kiosk',
  '/onboarding': 'Onboarding',
  '/wall': 'Live wall',
};

export const FALLBACK_SECTION: ConsoleSection = {
  key: 'dashboard', title: 'Dashboard', icon: 'dashboard', home: '/', items: [],
};

export const SYSTEM_SECTION: ConsoleSection = {
  key: 'system', title: 'System', icon: 'activity', home: '/', items: [],
};

export function pageTitleFor(pathname: string, section: ConsoleSection): string {
  const exact = PAGE_TITLES[pathname];
  if (exact) return exact;
  if (pathname.startsWith('/wall')) return 'Live wall';
  if (pathname.startsWith('/status/')) return 'System status';
  return section.title;
}
