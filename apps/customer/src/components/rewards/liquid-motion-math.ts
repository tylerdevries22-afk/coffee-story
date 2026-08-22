/**
 * Sensor-to-screen geometry for the glass heart's liquid.
 *
 * Split from the hook that uses it so it can be unit-tested without pulling in
 * expo-sensors or Reanimated.
 */

/**
 * Sign of the tilt the surface adopts for a given gravity direction.
 *
 * If the liquid ever leans uphill on a real device, this is the single knob to
 * flip — everything downstream derives from it. It cannot be verified on a
 * simulator, which reports no motion at all.
 */
const TILT_SIGN = -1;

/**
 * Angle, in the container's frame, of the surface that is level with the world.
 *
 * `gx`/`gy` are the gravity-inclusive acceleration components the device
 * reports; `orientation` is its rotation in degrees (0 portrait, 90 / -90
 * landscape, 180 upside down). Gravity is rotated back into screen space first,
 * so the liquid keeps finding true level when the phone is turned sideways
 * rather than leaning by a fixed 90 degrees.
 *
 * Returns 0 in free fall, where gravity gives no usable direction.
 */
export function screenGravityAngle(gx: number, gy: number, orientation: number): number {
  const radians = (orientation * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const screenX = gx * cos + gy * sin;
  const screenY = -gx * sin + gy * cos;

  // Below roughly 0.2 g the direction is noise, not down.
  if (Math.hypot(screenX, screenY) < 2) return 0;
  return TILT_SIGN * Math.atan2(screenX, -screenY);
}
