import { useMemo } from 'react';

import { buildClientNotifications, type NotificationItem } from '@platform/domain';
import { NotificationsScreen } from '@/screens/notifications-screen';
import { useAppState } from '@/state/app-context';
import { useAuth } from '@/state/auth-context';

/**
 * Pushed from the client tabs (see `openNotifications` in
 * `state/app-context.tsx`) onto the root Stack, so it draws above the native
 * tab bar no matter which tab was active. The staff feed lives in the
 * Operator app; this binary only ever builds the client feed.
 */
export default function NotificationsRoute() {
  const {
    closeNotifications, openMore, setClientTab, unreadNotificationIds,
  } = useAppState();
  const { portal } = useAuth();
  const notifications = useMemo(() => buildClientNotifications(portal, new Date()), [portal]);

  function follow(item: NotificationItem) {
    closeNotifications();
    if (item.target.kind === 'rewards') setClientTab('rewards');
    else if (item.target.kind === 'gift-balance') openMore('gift-balance');
    else openMore('orders');
  }

  return (
    <NotificationsScreen
      items={notifications}
      unreadIds={unreadNotificationIds}
      onClose={closeNotifications}
      onOpen={follow}
      onAction={follow}
    />
  );
}
