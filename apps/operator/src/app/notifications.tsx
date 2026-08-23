import { useMemo } from 'react';
import { Alert } from 'react-native';

import { StaffWorkspaceGate } from '@/components/staff/workspace-gate';
import { buildStaffNotifications, type NotificationItem } from '@/features/notifications/feed';
import { NotificationsScreen } from '@/screens/notifications-screen';
import { useAppState } from '@/state/app-context';
import { StaffWorkspaceProvider, useStaffWorkspace } from '@/state/staff-workspace';

/**
 * Pushed from the staff tabs onto the root Stack so it draws above the tab
 * bar. The client feed lives in the customer app; this binary only ever
 * builds the workspace feed.
 *
 * It carries its own workspace provider because that root Stack sits *outside*
 * `staff/_layout.tsx`: reading the context here without one threw
 * "useStaffWorkspace must be used within StaffWorkspaceProvider" the moment
 * anyone tapped the notification bell. Hoisting the provider to the root layout
 * instead would fire its dashboard fetch before sign-in, since it has no auth
 * guard of its own. The duplicate fetch this costs goes away when the feed is
 * rebuilt on order events and stops needing the booking dashboard at all.
 */
export default function NotificationsRoute() {
  return (
    <StaffWorkspaceProvider>
      <StaffWorkspaceGate>
        <NotificationsContent />
      </StaffWorkspaceGate>
    </StaffWorkspaceProvider>
  );
}

function NotificationsContent() {
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
