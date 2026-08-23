import * as Haptics from 'expo-haptics';
import * as Linking from 'expo-linking';
import { router, usePathname, type Href } from 'expo-router';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type PropsWithChildren } from 'react';

import { useAuth } from '@/state/auth-context';
import { useDemo } from '@/state/demo-context';
import { destinationForIntentUrl, giftTokenFromUrl } from '@/state/intent-links';
import {
  clientMoreHref,
  clientMoreViewFromPathname,
  clientTabFromPathname,
  clientTabHref,
  staffDestinationHref,
  staffDetailPathFromPathname,
  staffTabFromPathname,
  staffTabHref,
} from '@/state/navigation-state';
import type { AppRole } from '@/types/domain';

import type { ClientTab, MoreView, StaffTab } from '@/state/navigation-state';

export type { AppRole } from '@/types/domain';
export type { ClientTab, MoreView, StaffTab } from '@/state/navigation-state';

type AppState = {
  role: AppRole;
  isStaffMode: boolean;
  clientTab: ClientTab;
  staffTab: StaffTab;
  selectedServiceId: string | null;
  giftClaimToken: string | null;
  moreView: MoreView;
  staffDetailPath: string | null;
  /** Everything seen so far this session; drives the header badge count. */
  readNotificationIds: ReadonlySet<string>;
  /**
   * What was still unread the moment the page opened. Instagram keeps those
   * rows highlighted for the duration of the visit even though the badge
   * clears immediately, so the highlight reads from this snapshot rather than
   * from the live read set.
   */
  unreadNotificationIds: ReadonlySet<string>;
  openNotifications: (visibleIds: readonly string[]) => void;
  /**
   * True while a full-screen flow page covers the tab bar (the order flow's
   * setup and checkout pages). Native pages simply draw over the native bar;
   * the web bar is a sibling layer that cannot be painted over from inside
   * the screen subtree (react-native-web gives every View z-index: 0), so it
   * hides itself on this signal instead.
   */
  barCovered: boolean;
  setBarCovered: (covered: boolean) => void;
  closeNotifications: () => void;
  setClientTab: (tab: ClientTab) => void;
  setStaffTab: (tab: StaffTab) => void;
  startOrder: (itemId?: string) => void;
  consumeGiftClaimToken: () => void;
  openMore: (view: MoreView) => void;
  enterStaff: () => void;
  exitStaff: () => void;
  selectRole: (role: AppRole) => void;
  openStaffDestination: (path: string) => void;
  closeStaffDestination: () => void;
};

const AppContext = createContext<AppState | null>(null);

function selectionFeedback() {
  void Haptics.selectionAsync().catch(() => undefined);
}

/**
 * `typedRoutes` narrows `Href` to a union of the literal paths in `src/app`.
 * These hrefs are assembled at runtime from tab keys and admin paths, so they
 * cannot be proven members of that union at compile time. `navigation-state`
 * is the only place that builds them and its tests pin every value it emits,
 * so the assertion is checked there rather than by the compiler.
 */
function go(href: string, mode: 'navigate' | 'push' | 'replace' | 'dismissTo' = 'navigate') {
  router[mode](href as Href);
}

export function AppStateProvider({ children }: PropsWithChildren) {
  const { isDemo, role } = useAuth();
  const demo = useDemo();
  const pathname = usePathname();
  const [modeOverride, setModeOverride] = useState<{ role: AppRole; isStaffMode: boolean } | null>(null);
  const [selectedServiceId, setSelectedServiceId] = useState<string | null>(null);
  const [giftClaimToken, setGiftClaimToken] = useState<string | null>(null);

  // Where you are is now the router's business, not this provider's. Reading it
  // back out keeps the `clientTab` / `moreView` / `staffDetailPath` fields that
  // screens already consume, so nothing downstream had to learn about routes.
  const clientTab = clientTabFromPathname(pathname);
  const moreView = clientMoreViewFromPathname(pathname);
  const staffTab = staffTabFromPathname(pathname);
  const staffDetailPath = staffDetailPathFromPathname(pathname);
  // Read ids accumulate for the session. Anything absent is unread, so a
  // notification generated later still arrives unread with no extra bookkeeping.
  const [barCovered, setBarCovered] = useState(false);
  const [readNotificationIds, setReadNotificationIds] = useState<ReadonlySet<string>>(new Set());
  const [unreadNotificationIds, setUnreadNotificationIds] = useState<ReadonlySet<string>>(new Set());

  const isStaffMode = modeOverride?.role === role
    ? modeOverride.isStaffMode
    : role === 'staff' || role === 'admin';

  // Role persistence updates AuthContext asynchronously. Navigating to the
  // other persona in the same press handler raced that update: the old shell's
  // guard could redirect first and leave NativeTabs mounted with an empty
  // body. Move the shell transition to an effect that runs only after the new
  // role and its mode override agree.
  useEffect(() => {
    if (!modeOverride || modeOverride.role !== role) return;
    const inStaffShell = pathname.startsWith('/staff');
    if (modeOverride.isStaffMode === inStaffShell) return;
    go(
      modeOverride.isStaffMode ? staffTabHref('more') : clientMoreHref('menu'),
      'replace',
    );
  }, [modeOverride, pathname, role]);

  // A real pushed route rather than a boolean overlay: it needs to draw above
  // the native tab bar from any tab, and a router push does that (and gets a
  // native swipe-back) for free, where a sibling RN overlay would have to
  // fight the tab bar's own native z-order.
  const openNotifications = useCallback((visibleIds: readonly string[]) => {
    selectionFeedback();
    setUnreadNotificationIds(new Set(visibleIds.filter((id) => !readNotificationIds.has(id))));
    setReadNotificationIds(new Set([...readNotificationIds, ...visibleIds]));
    go('/notifications', 'push');
  }, [readNotificationIds]);
  const closeNotifications = useCallback(() => {
    if (router.canGoBack()) router.back();
  }, []);

  const setClientTab = useCallback((tab: ClientTab) => {
    selectionFeedback();
    go(clientTabHref(tab));
  }, []);
  const setStaffTab = useCallback((tab: StaffTab) => {
    selectionFeedback();
    go(staffTabHref(tab));
  }, []);
  const startOrder = useCallback((itemId?: string) => {
    selectionFeedback();
    setSelectedServiceId(itemId ?? null);
    go(clientTabHref('book'));
  }, []);
  const openGiftClaim = useCallback((token: string) => {
    selectionFeedback();
    setGiftClaimToken(token);
    go(clientTabHref('gift'));
  }, []);
  const consumeGiftClaimToken = useCallback(() => setGiftClaimToken(null), []);
  const openMore = useCallback((view: MoreView) => {
    selectionFeedback();
    // The menu is the root of the More stack, so returning to it pops whatever
    // is on top rather than pushing a second copy underneath it.
    if (view === 'menu') go(clientMoreHref('menu'), 'dismissTo');
    else go(clientMoreHref(view), 'push');
  }, []);

  // Siri / App Intents deep links (coffeestory://book|visits|rewards|gift).
  useEffect(() => {
    const dispatch = (url: string | null) => {
      const giftToken = giftTokenFromUrl(url);
      if (giftToken) {
        openGiftClaim(giftToken);
        return;
      }
      const destination = destinationForIntentUrl(url);
      if (!destination) return;
      if (destination === 'book') startOrder();
      else if (destination === 'visits') openMore('visits');
      else setClientTab(destination);
    };
    void Linking.getInitialURL().then(dispatch);
    const subscription = Linking.addEventListener('url', ({ url }) => dispatch(url));
    return () => subscription.remove();
  }, [openGiftClaim, startOrder, openMore, setClientTab]);

  const openStaffDestination = useCallback((path: string) => {
    selectionFeedback();
    go(staffDestinationHref(path), 'push');
  }, []);
  const closeStaffDestination = useCallback(() => {
    selectionFeedback();
    if (router.canGoBack()) router.back();
    else go(staffTabHref('more'), 'replace');
  }, []);

  const value = useMemo<AppState>(() => ({
    role,
    isStaffMode,
    clientTab,
    staffTab,
    selectedServiceId,
    giftClaimToken,
    moreView,
    staffDetailPath,
    readNotificationIds,
    unreadNotificationIds,
    openNotifications,
    closeNotifications,
    setClientTab,
    setStaffTab,
    startOrder,
    consumeGiftClaimToken,
    openMore,
    enterStaff: () => {
      if (role === 'staff' || role === 'admin') {
        setModeOverride({ role, isStaffMode: true });
        go(staffTabHref('today'), 'replace');
      }
    },
    exitStaff: () => {
      selectionFeedback();
      setModeOverride({ role, isStaffMode: false });
      go(clientTabHref('home'), 'replace');
    },
    selectRole: (nextRole) => {
      if (!isDemo) return;
      selectionFeedback();
      demo.setRole(nextRole);
      // Stay on More. The role switch lives on the More page in every persona,
      // so landing on Home/Today threw the picker off screen and made comparing
      // personas a three-tap round trip.
      if (nextRole === 'client') {
        setModeOverride({ role: nextRole, isStaffMode: false });
      } else {
        setModeOverride({ role: nextRole, isStaffMode: true });
      }
    },
    openStaffDestination,
    closeStaffDestination,
    barCovered,
    setBarCovered,
  }), [barCovered, 
    clientTab,
    consumeGiftClaimToken,
    closeNotifications,
    closeStaffDestination,
    demo,
    isDemo,
    isStaffMode,
    giftClaimToken,
    moreView,
    openMore,
    openNotifications,
    openStaffDestination,
    readNotificationIds,
    role,
    selectedServiceId,
    setClientTab,
    setStaffTab,
    staffDetailPath,
    staffTab,
    startOrder,
    unreadNotificationIds,
  ]);
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useAppState(): AppState {
  const state = useContext(AppContext);
  if (!state) throw new Error('useAppState must be used within AppStateProvider');
  return state;
}
