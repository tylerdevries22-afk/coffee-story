import type { IconName } from '@/components/icon';

// The catalog itself lives in console-sections; this file owns only the rule
// that decides which of it a given access set may see.
import {
  APPS_SECTION,
  CAMPAIGNS_SECTION,
  CUSTOMERS_SECTION,
  DASHBOARD_SECTION,
  DROPS_SECTION,
  INTEGRATIONS_SECTION,
  OPERATIONS_SECTION,
  analyticsSection,
  contentSection,
  settingsSection,
} from './console-sections';
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
  /** `growth-drops` is installed for the selected brand. */
  readonly canManageDrops: boolean;
  /** The selected brand holds any growth module; see lib/capabilities. */
  readonly canManageCampaigns: boolean;
};

/** Returns every console destination available to the current role, grouped once. */
export function consoleSectionsFor(access: ConsoleNavigationAccess): ConsoleSection[] {
  return [
    DASHBOARD_SECTION,
    APPS_SECTION,
    contentSection(access),
    ...(access.canManageDrops ? [DROPS_SECTION] : []),
    ...(access.canManageCampaigns ? [CAMPAIGNS_SECTION] : []),
    CUSTOMERS_SECTION,
    ...(access.canManageOperations ? [OPERATIONS_SECTION] : []),
    ...(access.canViewAnalytics ? [analyticsSection(access)] : []),
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
