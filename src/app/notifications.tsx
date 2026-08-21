import { useMemo } from 'react';
import { Alert } from 'react-native';

import { buildClientNotifications, buildStaffNotifications, type NotificationItem } from '@/features/notifications/feed';
import { NotificationsScreen } from '@/screens/notifications-screen';
import { useAppState } from '@/state/app-context';
import { useAuth } from '@/state/auth-context';
import { useStaffWorkspace } from '@/state/staff-workspace';

/**
 * A single route for both shells rather than `/client/notifications` and
 * `/staff/notifications`: it needs no shell-specific layout, and `isStaffMode`
 * already tells it which feed to build. Pushed from either shell's tabs (see
 * `openNotifications` in `state/app-context.tsx`) onto the root Stack, so it
 * draws above the native tab bar no matter which tab was active.
 */
export default function NotificationsRoute() {
  const { isStaffMode } = useAppState();
  return isStaffMode ? <StaffNotifications /> : <ClientNotifications />;
}

function ClientNotifications() {
  const {
    closeNotifications, openMore, setClientTab, unreadNotificationIds,
  } = useAppState();
  const { portal } = useAuth();
  const notifications = useMemo(() => buildClientNotifications(portal, new Date()), [portal]);

  function follow(item: NotificationItem) {
    closeNotifications();
    if (item.target.kind === 'rewards') setClientTab('rewards');
    else if (item.target.kind === 'gift-balance') openMore('gift-balance');
    else openMore('visits');
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

function StaffNotifications() {
  const { closeNotifications, setStaffTab, unreadNotificationIds } = useAppState();
  const { dashboard, updateStatus } = useStaffWorkspace();
  const notifications = useMemo(() => buildStaffNotifications(dashboard, new Date()), [dashboard]);

  // A workspace alert either resolves in place (confirm a visit) or hands off
  // to the tab that can finish the job.
  function follow(item: NotificationItem) {
    closeNotifications();
    if (item.target.kind === 'confirm-visit') {
      void updateStatus(item.target.appointmentId, 'confirmed').catch((statusError: unknown) => {
        Alert.alert('Visit not updated', statusError instanceof Error ? statusError.message : 'Try again in a moment.');
      });
      return;
    }
    setStaffTab(item.target.kind === 'staff-checkout' ? 'checkout' : 'calendar');
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
