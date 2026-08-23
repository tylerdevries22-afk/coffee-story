/**
 * The single map between the app's navigation vocabulary and its route paths.
 *
 * The shells used to hold their position in React state and render whichever
 * screen matched. Now the router holds it, and the tab bars are real
 * `UITabBar`s (see `components/navigation/`), so every destination the product
 * talks about — a client tab, a More sub-page, a staff admin path — has to
 * name an actual route. This module owns that translation in both directions
 * and nothing else: it is pure, so it stays unit-testable without a navigator.
 *
 * Client and staff live under real `client/` and `staff/` segments rather than
 * route groups. Groups are erased from the URL, and both shells own a "More"
 * destination, so two `(client)`/`(staff)` groups would have declared the same
 * `/more` route and collided.
 */

export type ClientTab = 'home' | 'book' | 'gift' | 'rewards' | 'more';
export type StaffTab = 'orders' | 'today' | 'more';
export type MoreView =
  | 'menu' | 'services' | 'orders' | 'profile' | 'preferences' | 'messages' | 'membership'
  | 'payments' | 'gift-balance' | 'location' | 'resources' | 'faq' | 'care-policy'
  | 'privacy' | 'admin';

/** Left-to-right order of the client tab bar. */
export const CLIENT_TAB_ORDER: readonly ClientTab[] = ['home', 'gift', 'book', 'rewards', 'more'];
export const CLIENT_TAB_LABELS: Readonly<Record<ClientTab, string>> = {
  home: 'Home',
  gift: 'Gift',
  book: 'Order',
  rewards: 'Rewards',
  more: 'More',
};

/**
 * Left-to-right order of the staff tab bar.
 *
 * The board is first: this app is a KDS, and the tab a device lands on when it
 * wakes should be the one a barista is already looking at.
 */
export const STAFF_TAB_ORDER: readonly StaffTab[] = ['orders', 'today', 'more'];
export const STAFF_TAB_LABELS: Readonly<Record<StaffTab, string>> = {
  orders: 'Orders',
  today: 'Today',
  more: 'More',
};

const CLIENT_ROOT = '/client';
const STAFF_ROOT = '/staff';

/**
 * Admin paths the web portal uses that land on a staff *tab* rather than on a
 * pushed detail page. Everything not listed here is a detail page.
 */
const STAFF_TAB_PATHS: Readonly<Record<string, StaffTab>> = {
  '/admin/dashboard': 'today',
};

export function clientTabHref(tab: ClientTab): string {
  return `${CLIENT_ROOT}/${tab}`;
}

export function clientMoreHref(view: MoreView): string {
  return view === 'menu' ? `${CLIENT_ROOT}/more` : `${CLIENT_ROOT}/more/${view}`;
}

export function staffTabHref(tab: StaffTab): string {
  return `${STAFF_ROOT}/${tab}`;
}

/**
 * Where an admin path from the web portal opens in the app.
 *
 * Four of them are tabs; the rest push onto the More stack under their own
 * path, so the URL a therapist deep-links to survives into the app and the
 * back gesture behaves like every other pushed page.
 */
export function staffDestinationHref(path: string): string {
  const tab = STAFF_TAB_PATHS[path];
  if (tab) return staffTabHref(tab);
  return `${STAFF_ROOT}/more${path.startsWith('/') ? path : `/${path}`}`;
}

/** The tab a pathname belongs to, for anything that highlights the current one. */
export function clientTabFromPathname(pathname: string): ClientTab {
  const segment = segmentsOf(pathname, CLIENT_ROOT)[0];
  return CLIENT_TAB_ORDER.find((tab) => tab === segment) ?? 'home';
}

export function clientMoreViewFromPathname(pathname: string): MoreView {
  const [first, second] = segmentsOf(pathname, CLIENT_ROOT);
  if (first !== 'more' || !second) return 'menu';
  return isMoreView(second) ? second : 'menu';
}

export function staffTabFromPathname(pathname: string): StaffTab {
  const [first] = segmentsOf(pathname, STAFF_ROOT);
  return STAFF_TAB_ORDER.find((tab) => tab === first) ?? 'orders';
}

/**
 * The admin path a staff More route is showing, or null on the menu itself.
 * The inverse of the detail branch of `staffDestinationHref`.
 */
export function staffDetailPathFromPathname(pathname: string): string | null {
  const segments = segmentsOf(pathname, STAFF_ROOT);
  if (segments[0] !== 'more' || segments.length < 2) return null;
  return `/${segments.slice(1).join('/')}`;
}

const MORE_VIEWS: readonly MoreView[] = [
  'menu', 'services', 'orders', 'profile', 'preferences', 'messages', 'membership',
  'payments', 'gift-balance', 'location', 'resources', 'faq', 'care-policy',
  'privacy', 'admin',
];

export function isMoreView(value: string): value is MoreView {
  return (MORE_VIEWS as readonly string[]).includes(value);
}

/** Path segments after the shell root, ignoring query strings and fragments. */
function segmentsOf(pathname: string, root: string): string[] {
  const withoutQuery = pathname.split(/[?#]/)[0] ?? '';
  if (!withoutQuery.startsWith(root)) return [];
  return withoutQuery.slice(root.length).split('/').filter(Boolean);
}
