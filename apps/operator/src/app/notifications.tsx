import { useMemo } from 'react';
import { Alert } from 'react-native';

import { buildStaffNotifications, type NotificationItem } from '@/features/notifications/feed';
import { NotificationsScreen } from '@/screens/notifications-screen';
import { useAppState } from '@/state/app-context';
import { useStaffWorkspace } from '@/state/staff-workspace';

/**
 * Pushed from the staff tabs onto the root Stack so it draws above the tab
 * bar. The client feed lives in the customer app; this binary only ever
 * builds the workspace feed.
 */
export default function NotificationsRoute() {
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
    // The feed still speaks the booking workspace's vocabulary (`staff-checkout`,
    // `confirm-visit`); the register and calendar those targets opened are gone.
    // Land on the board until the feed is rebuilt around order events.
    setStaffTab('orders');
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
