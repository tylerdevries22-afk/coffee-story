/**
 * Push registration, guarded three ways: never in Demo (nothing to notify),
 * never in Expo Go (SDK 53 removed remote push from Expo Go), never without
 * the user saying yes. Returns the Expo push token for the caller to attach
 * to the customer row server-side, or null with the reason logged.
 */
import Constants from 'expo-constants';
import { Platform } from 'react-native';

export async function registerForPush(): Promise<string | null> {
  if (Constants.appOwnership === 'expo') return null; // Expo Go cannot receive remote push
  try {
    const Notifications = await import('expo-notifications');
    const existing = await Notifications.getPermissionsAsync();
    let status = existing.status;
    if (status !== 'granted') {
      status = (await Notifications.requestPermissionsAsync()).status;
    }
    if (status !== 'granted') return null;
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'Order updates',
        importance: Notifications.AndroidImportance.HIGH,
      });
    }
    const projectId: string | undefined =
      (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId;
    const token = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined);
    return token.data;
  } catch (error) {
    console.warn('Push registration unavailable', error instanceof Error ? error.message : error);
    return null;
  }
}
