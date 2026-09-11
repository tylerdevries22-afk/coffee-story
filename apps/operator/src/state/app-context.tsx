import { usePathname } from 'expo-router';
import { useCallback, useContext, useEffect, useMemo, useState, type PropsWithChildren } from 'react';

import { useAuth } from '@/state/auth-context';
import { useDemo } from '@/state/demo-context';
import {
  SETUP_AUTO_PROMPT_DELAY_MS,
  shouldScheduleSetupAutoPrompt,
} from '@/features/setup/setup';
import {
  clientMoreHref,
  clientMoreViewFromPathname,
  clientTabFromPathname,
  clientTabHref,
  staffDetailPathFromPathname,
  staffTabFromPathname,
  staffTabHref,
} from '@/state/navigation-state';
import type { AppRole } from '@platform/domain';

export type { AppRole } from '@platform/domain';
export type { ClientTab, MoreView, StaffTab } from '@/state/navigation-state';

import { useAppDeepLinks } from './app-deep-links';
import { useAppNavigationActions } from './app-navigation-actions';
import { AppContext, go, selectionFeedback, type AppState } from './app-context-shared';

export function AppStateProvider({ children }: PropsWithChildren) {
  const { isDemo, role } = useAuth();
  const demo = useDemo();
  const pathname = usePathname();
  const [modeOverride, setModeOverride] = useState<{ role: AppRole; isStaffMode: boolean } | null>(null);
  const [setupPrompt, setSetupPrompt] = useState<{
    role: AppRole;
    source: 'auto' | 'manual';
  } | null>(null);

  // Where you are is now the router's business, not this provider's. Reading it
  // back out keeps the `clientTab` / `moreView` / `staffDetailPath` fields that
  // screens already consume, so nothing downstream had to learn about routes.
  const clientTab = clientTabFromPathname(pathname);
  const moreView = clientMoreViewFromPathname(pathname);
  const staffTab = staffTabFromPathname(pathname);
  const staffDetailPath = staffDetailPathFromPathname(pathname);
  const setupPromptRole = setupPrompt?.role ?? null;
  const queueSetupPrompt = useCallback((promptRole: AppRole) => {
    setSetupPrompt({ role: promptRole, source: 'manual' });
  }, []);
  const dismissSetupPrompt = useCallback(() => {
    // Closing or completing either presentation consumes the pending automatic
    // offer. Manual opening itself remains immediate and does not dismiss it.
    if (setupPrompt && isDemo) demo.dismissSetupAutoPrompt();
    setSetupPrompt(null);
  }, [demo, isDemo, setupPrompt]);
  // Read ids accumulate for the session. Anything absent is unread, so a
  // notification generated later still arrives unread with no extra bookkeeping.
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

  useEffect(() => {
    const shouldSchedule = shouldScheduleSetupAutoPrompt({
      isDemo,
      isHydrating: demo.isHydrating,
      dismissed: demo.portal.autoPromptDismissed === true,
      promptOpen: setupPrompt !== null,
    });
    if (!shouldSchedule) return undefined;
    const stableRole = role;
    const timer = setTimeout(() => {
      setSetupPrompt({ role: stableRole, source: 'auto' });
    }, SETUP_AUTO_PROMPT_DELAY_MS);
    return () => clearTimeout(timer);
  }, [demo.isHydrating, demo.portal.autoPromptDismissed, isDemo, role, setupPrompt]);

  const { closeNotifications, closeStaffDestination, consumeGiftClaimToken, giftClaimToken,
    openGiftClaim, openMore, openNotifications, openStaffDestination, selectedServiceId,
    setClientTab, setStaffTab, startOrder } = useAppNavigationActions(
    readNotificationIds, setReadNotificationIds, setUnreadNotificationIds,
  );

  useAppDeepLinks({ openGiftClaim, openMore, setClientTab, startOrder });


  const value = useMemo<AppState>(() => ({
    role,
    isStaffMode,
    clientTab,
    staffTab,
    selectedServiceId,
    giftClaimToken,
    moreView,
    staffDetailPath,
    setupPromptRole,
    queueSetupPrompt,
    dismissSetupPrompt,
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
        go(staffTabHref('orders'), 'replace');
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
      // A role must stay selected for three seconds before setup is offered.
      // Clearing the current request here also cancels an open automatic prompt
      // before the destination workspace replaces it.
      if (nextRole !== role) {
        if (setupPrompt?.source === 'auto') demo.dismissSetupAutoPrompt();
        setSetupPrompt(null);
      }
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
  }), [
    clientTab,
    consumeGiftClaimToken,
    closeNotifications,
    closeStaffDestination,
    demo,
    dismissSetupPrompt,
    queueSetupPrompt,
    setupPromptRole,
    setupPrompt?.source,
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
