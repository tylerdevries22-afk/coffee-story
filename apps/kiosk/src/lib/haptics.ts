/**
 * Haptics, in one place that knows the web exists.
 *
 * `expo-haptics` rejects with an UnavailabilityError on web, and the kiosk is
 * exported to static web for `docs/captures`. Swallowing that at thirty call
 * sites is thirty chances to forget; swallowing it here is one.
 *
 * Feedback is not motion, so none of this is suppressed under reduced motion.
 */
import { Platform } from 'react-native';
import * as Haptics from 'expo-haptics';

const available = Platform.OS !== 'web';

/** A choice being made -- a tile, a stepper, a tender. */
export function tapped(): void {
  if (!available) return;
  void Haptics.selectionAsync().catch(() => undefined);
}

/** A thing landing -- a choice reaching its slot, a line reaching the bag. */
export function landed(): void {
  if (!available) return;
  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
}

/** A tap that could not be honoured -- a full box, an item that is 86'd. */
export function refused(): void {
  if (!available) return;
  void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => undefined);
}

/** The order is placed. */
export function completed(): void {
  if (!available) return;
  void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
}
