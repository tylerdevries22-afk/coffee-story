import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { router, type Href } from 'expo-router';
import { useEffect } from 'react';
import { Platform } from 'react-native';

import { registerOperationDeviceToken } from './api';
import { operationNotificationOccurrenceId } from './push-navigation';

if (Platform.OS !== 'web') {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldPlaySound: false,
      shouldSetBadge: true,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });
}

function permissionGranted(permission: Notifications.NotificationPermissionsStatus): boolean {
  if (Platform.OS !== 'ios') return permission.granted;
  const status = permission.ios?.status;
  return status === Notifications.IosAuthorizationStatus.AUTHORIZED
    || status === Notifications.IosAuthorizationStatus.PROVISIONAL
    || status === Notifications.IosAuthorizationStatus.EPHEMERAL;
}

/** Requests permission once and registers the SDK 54 Expo token with the tenant API. */
export async function registerOperationPush(): Promise<string | null> {
  if (Platform.OS !== 'ios' && Platform.OS !== 'android') return null;
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('shift-tasks', {
      name: 'Shift task updates',
      importance: Notifications.AndroidImportance.HIGH,
    });
  }
  let permission = await Notifications.getPermissionsAsync();
  if (!permissionGranted(permission) && permission.status === 'undetermined') {
    permission = await Notifications.requestPermissionsAsync();
  }
  if (!permissionGranted(permission)) return null;
  const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
  if (typeof projectId !== 'string' || !projectId) return null;
  const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
  await registerOperationDeviceToken(token, Platform.OS);
  return token;
}

function openNotification(notification: Notifications.Notification): void {
  const occurrenceId = operationNotificationOccurrenceId(notification.request.content.data);
  if (!occurrenceId) return;
  router.push(`/staff/crew/${encodeURIComponent(occurrenceId)}` as Href);
}

/** Handles cold-start and foreground notification responses through Expo Router. */
export function useOperationNotificationObserver(): void {
  useEffect(() => {
    if (Platform.OS === 'web') return undefined;
    const initial = Notifications.getLastNotificationResponse();
    if (initial?.notification) openNotification(initial.notification);
    const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
      openNotification(response.notification);
    });
    return () => subscription.remove();
  }, []);
}
