import * as Haptics from 'expo-haptics';

/**
 * Haptic vocabulary for the Rewards tab, shared by the screen and its sheets.
 *
 * Every call is fire-and-forget: a device without a Taptic Engine rejects these
 * and a rewards interaction must never fail because the phone cannot buzz.
 */
export function hapticSelection() {
  void Haptics.selectionAsync().catch(() => undefined);
}

export function hapticSuccess() {
  void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
}

export function hapticError() {
  void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => undefined);
}
