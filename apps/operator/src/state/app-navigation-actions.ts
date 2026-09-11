import { router } from 'expo-router';
import { useCallback, useState } from 'react';

import { clientMoreHref, clientTabHref, staffDestinationHref, staffTabHref, type ClientTab, type MoreView, type StaffTab } from '@/state/navigation-state';
import { go, selectionFeedback } from './app-context-shared';

export function useAppNavigationActions(
  readNotificationIds: ReadonlySet<string>,
  setReadNotificationIds: (ids: ReadonlySet<string>) => void,
  setUnreadNotificationIds: (ids: ReadonlySet<string>) => void,
) {
  const [selectedServiceId, setSelectedServiceId] = useState<string | null>(null);
  const [giftClaimToken, setGiftClaimToken] = useState<string | null>(null);
  const openNotifications = useCallback((visibleIds: readonly string[]) => {
    selectionFeedback();
    setUnreadNotificationIds(new Set(visibleIds.filter((id) => !readNotificationIds.has(id))));
    setReadNotificationIds(new Set([...readNotificationIds, ...visibleIds]));
    go('/notifications', 'push');
  }, [readNotificationIds, setReadNotificationIds, setUnreadNotificationIds]);
  const closeNotifications = useCallback(() => { if (router.canGoBack()) router.back(); }, []);
  const setClientTab = useCallback((tab: ClientTab) => { selectionFeedback(); go(clientTabHref(tab)); }, []);
  const setStaffTab = useCallback((tab: StaffTab) => { selectionFeedback(); go(staffTabHref(tab)); }, []);
  const startOrder = useCallback((itemId?: string) => { selectionFeedback(); setSelectedServiceId(itemId ?? null); go(clientTabHref('book')); }, []);
  const openGiftClaim = useCallback((token: string) => { selectionFeedback(); setGiftClaimToken(token); go(clientTabHref('gift')); }, []);
  const consumeGiftClaimToken = useCallback(() => setGiftClaimToken(null), []);
  const openMore = useCallback((view: MoreView) => {
    selectionFeedback();
    if (view === 'menu') go(clientMoreHref('menu'), 'dismissTo');
    else go(clientMoreHref(view), 'push');
  }, []);
  const openStaffDestination = useCallback((path: string) => { selectionFeedback(); go(staffDestinationHref(path), 'push'); }, []);
  const closeStaffDestination = useCallback(() => {
    selectionFeedback();
    if (router.canGoBack()) router.back();
    else go(staffTabHref('more'), 'replace');
  }, []);
  return { closeNotifications, closeStaffDestination, consumeGiftClaimToken, giftClaimToken,
    openGiftClaim, openMore, openNotifications, openStaffDestination, selectedServiceId,
    setClientTab, setStaffTab, startOrder };
}
