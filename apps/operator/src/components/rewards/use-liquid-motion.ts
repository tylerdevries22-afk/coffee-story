import { useEffect } from 'react';
import { useSharedValue, type SharedValue } from 'react-native-reanimated';

import { screenGravityAngle } from './liquid-motion-math';

/**
 * Feeds the glass heart's sloshing model from the device's motion sensors.
 *
 * The two outputs are exactly the two inputs `stepSlosh` wants, so the pan
 * gesture and the gyroscope are interchangeable sources — on a simulator, or on
 * a device with no motion hardware, the drag path supplies them instead and the
 * liquid behaves identically.
 *
 * expo-sensors is loaded with a dynamic import so `node:test` never evaluates
 * the native module, matching how the rest of the app defers native access.
 */
export type LiquidMotion = {
  /** Where level lies in the container's frame, radians. */
  gravityAngle: SharedValue<number>;
  /** Lateral acceleration across the screen, m/s^2, gravity excluded. */
  lateral: SharedValue<number>;
};

/** 60 Hz. Matches the frame loop that consumes it; faster only burns battery. */
const UPDATE_INTERVAL_MS = 16;

export function useLiquidMotion(enabled: boolean): LiquidMotion {
  const gravityAngle = useSharedValue(0);
  const lateral = useSharedValue(0);

  useEffect(() => {
    if (!enabled) {
      gravityAngle.value = 0;
      lateral.value = 0;
      return undefined;
    }

    let cancelled = false;
    let subscription: { remove: () => void } | undefined;

    void (async () => {
      try {
        const { DeviceMotion } = await import('expo-sensors');
        const available = await DeviceMotion.isAvailableAsync();
        // Simulators and motion-less devices land here; the drag path covers it.
        if (!available || cancelled) return;

        DeviceMotion.setUpdateInterval(UPDATE_INTERVAL_MS);
        subscription = DeviceMotion.addListener((motion) => {
          const gravity = motion.accelerationIncludingGravity;
          if (gravity) {
            gravityAngle.value = screenGravityAngle(gravity.x, gravity.y, motion.orientation ?? 0);
          }
          // `acceleration` already has gravity removed, which is what shakes the
          // liquid; using the gravity-inclusive vector would drive the surface
          // continuously just from being held.
          const linear = motion.acceleration;
          if (linear) lateral.value = linear.x;
        });
      } catch {
        // expo-sensors missing or motion unavailable: stay on the drag path.
      }
    })();

    return () => {
      cancelled = true;
      subscription?.remove();
      gravityAngle.value = 0;
      lateral.value = 0;
    };
  }, [enabled, gravityAngle, lateral]);

  return { gravityAngle, lateral };
}
