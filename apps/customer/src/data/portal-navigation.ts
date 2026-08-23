import type { AppRole } from '@/types/domain';

export type WebDestination = {
  title: string;
  path: string;
  subtitle?: string;
  roles: readonly AppRole[];
};

const STAFF_AND_ADMIN: readonly AppRole[] = ['staff', 'admin'];
const ADMIN_ONLY: readonly AppRole[] = ['admin'];

export const ADMIN_DESTINATIONS: readonly WebDestination[] = [
  { title: 'Admin dashboard', path: '/admin/dashboard', roles: STAFF_AND_ADMIN },
  { title: 'Calendar', path: '/admin/calendar', roles: STAFF_AND_ADMIN },
  { title: 'Guests', path: '/admin/clients', roles: STAFF_AND_ADMIN },
  { title: 'Point of sale', path: '/admin/pos', roles: STAFF_AND_ADMIN },
  { title: 'Menu & pricing', path: '/admin/services', roles: STAFF_AND_ADMIN },
  { title: 'Staff', path: '/admin/staff', roles: ADMIN_ONLY },
  { title: 'Reports', path: '/admin/reports', roles: ADMIN_ONLY },
  { title: 'Settings', path: '/admin/settings', roles: ADMIN_ONLY },
  { title: 'Talent acquisition', path: '/admin/talent-acquisition', roles: ADMIN_ONLY },
  { title: 'Rewards & points', path: '/admin/rewards', roles: STAFF_AND_ADMIN },
  { title: 'Reviews', path: '/admin/reviews', roles: STAFF_AND_ADMIN },
  { title: 'Marketing', path: '/admin/marketing', roles: ADMIN_ONLY },
  { title: 'Google Analytics', path: '/admin/analytics', roles: ADMIN_ONLY },
  { title: 'Google Ads', path: '/admin/ads', roles: ADMIN_ONLY },
] as const;

export const CLIENT_WEB_DESTINATIONS: readonly Omit<WebDestination, 'roles'>[] = [
  { title: 'Portal overview', path: '/account' },
  { title: 'Orders', path: '/account/orders' },
  { title: 'Order ahead', path: '/account/book' },
  { title: 'Gift cards', path: '/account/gift-cards' },
  { title: 'Send a gift', path: '/account/gift' },
  { title: 'My usual', path: '/account/preferences' },
  { title: 'Memberships', path: '/account/memberships' },
  { title: 'Messages', path: '/account/messages' },
  { title: 'More', path: '/account/more' },
  { title: 'Profile', path: '/account/profile' },
  { title: 'Rewards', path: '/account/rewards' },
] as const;

export function adminDestinationsForRole(role: AppRole): readonly WebDestination[] {
  return ADMIN_DESTINATIONS.filter((destination) => destination.roles.includes(role));
}
