import { ADMIN_DESTINATIONS, adminDestinationsForRole, type WebDestination , AppRole, StaffClient } from '@platform/domain';

export type AdminNavigationGroup = {
  title: 'Operations' | 'People' | 'Marketing' | 'Configuration';
  destinations: readonly WebDestination[];
};

export type AdminSearchResult =
  | { id: string; kind: 'destination'; title: string; subtitle: string; path: string }
  | { id: string; kind: 'client'; title: string; subtitle: string; path: '/admin/clients' };

const GROUP_PATHS: readonly {
  title: AdminNavigationGroup['title'];
  paths: readonly string[];
}[] = [
  {
    title: 'Operations',
    paths: ['/admin/dashboard', '/admin/calendar', '/admin/clients', '/admin/pos', '/admin/items'],
  },
  {
    title: 'People',
    paths: ['/admin/talent-acquisition', '/admin/staff'],
  },
  {
    title: 'Marketing',
    paths: ['/admin/rewards', '/admin/reviews', '/admin/marketing', '/admin/analytics', '/admin/ads'],
  },
  {
    title: 'Configuration',
    paths: ['/admin/settings'],
  },
] as const;

export function adminNavigationGroupsForRole(role: AppRole): readonly AdminNavigationGroup[] {
  const permitted = new Map(
    adminDestinationsForRole(role).map((destination) => [destination.path, destination]),
  );
  return GROUP_PATHS.map((group) => ({
    title: group.title,
    destinations: group.paths.flatMap((path) => {
      const destination = permitted.get(path);
      return destination ? [destination] : [];
    }),
  })).filter((group) => group.destinations.length > 0);
}

export function searchAdminWorkspace(
  query: string,
  role: AppRole,
  clients: readonly StaffClient[],
): readonly AdminSearchResult[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return [];
  const destinationResults: AdminSearchResult[] = adminDestinationsForRole(role)
    .filter((destination) => `${destination.title} ${destination.subtitle ?? ''}`.toLowerCase().includes(normalized))
    .map((destination) => ({
      id: `destination-${destination.path}`,
      kind: 'destination',
      title: destination.title,
      subtitle: 'Administration',
      path: destination.path,
    }));
  const clientResults: AdminSearchResult[] = clients
    .filter((client) => `${client.fullName} ${client.email} ${client.phone ?? ''}`.toLowerCase().includes(normalized))
    .slice(0, 6)
    .map((client) => ({
      id: `client-${client.id}`,
      kind: 'client',
      title: client.fullName,
      subtitle: client.email,
      path: '/admin/clients',
    }));
  return [...destinationResults, ...clientResults].slice(0, 12);
}

export function isNativeAdminDestination(path: string): boolean {
  return path === '/proposal' || ADMIN_DESTINATIONS.some((destination) => destination.path === path);
}
