import { useEffect, useMemo, useState } from 'react';
import { Alert } from 'react-native';
import { router, type Href } from 'expo-router';

import { StaffWorkspaceGate } from '@/components/staff/workspace-gate';
import { buildStaffNotifications, type NotificationItem } from '@platform/domain';
import {
  loadOperationNotifications,
  markOperationNotificationsRead,
} from '@/features/operations/api';
import type { OperatorNotification } from '@/features/operations/model';
import { NotificationsScreen } from '@/screens/notifications-screen';
import { useAppState } from '@/state/app-context';
import { StaffWorkspaceProvider, useStaffWorkspace } from '@/state/staff-workspace';
import { useAuth } from '@/state/auth-context';

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
  const { isDemo, operationsEnabled } = useAuth();
  const [operationNotifications, setOperationNotifications] = useState<readonly OperatorNotification[]>([]);
  useEffect(() => {
    if (isDemo || !operationsEnabled) return undefined;
    let active = true;
    void loadOperationNotifications().then((items) => {
      if (!active) return;
      setOperationNotifications(items);
      const unread = items.filter((item) => item.readAt === null).map((item) => item.id);
      if (unread.length > 0) void markOperationNotificationsRead(unread).catch(() => undefined);
    }).catch(() => undefined);
    return () => { active = false; };
  }, [isDemo, operationsEnabled]);
  const operationsByFeedId = useMemo(() => new Map<string, OperatorNotification>(
    operationNotifications.map((item) => [`operation-notification-${item.id}`, item]),
  ), [operationNotifications]);
  const notifications = useMemo(() => [
    ...operationNotifications.map(operationFeedItem),
    ...buildStaffNotifications(dashboard, new Date()),
  ], [dashboard, operationNotifications]);

  // A workspace alert either resolves in place (confirm a order) or hands off
  // to the tab that can finish the job.
  function follow(item: NotificationItem) {
    const operation = operationsByFeedId.get(item.id);
    if (operation?.occurrenceId) {
      closeNotifications();
      router.push(`/staff/crew/${encodeURIComponent(operation.occurrenceId)}` as Href);
      return;
    }
    closeNotifications();
    if (item.target.kind === 'confirm-order') {
      void updateStatus(item.target.orderId, 'paid').catch((statusError: unknown) => {
        Alert.alert('Order not updated', statusError instanceof Error ? statusError.message : 'Try again in a moment.');
      });
      return;
    }
    // The feed still speaks the booking workspace's vocabulary (`staff-checkout`,
    // `confirm-order`); the register and calendar those targets opened are gone.
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

function operationFeedItem(notification: OperatorNotification): NotificationItem {
  return {
    id: `operation-notification-${notification.id}`,
    actor: 'Shift tasks',
    title: notification.title,
    detail: notification.body,
    at: notification.createdAt,
    target: { kind: 'staff-calendar' },
    action: notification.occurrenceId ? 'Open' : undefined,
  };
}
