import { useMemo } from 'react';
import { Gesture } from 'react-native-gesture-handler';
import { Easing, useSharedValue, withSpring, withTiming, type SharedValue } from 'react-native-reanimated';

import { dragToMotion } from './liquid-physics';

/**
 * Length of the pour. Exported so the points counter can run on exactly the
 * same clock — the number and the liquid are meant to settle as one gesture.
 */
export const POUR_MS = 2600;

/**
 * The visible liquid level at elapsed fraction `t` of the pour, as plain JS.
 *
 * Composes the pour's inOut-quad easing with the same delay-and-smoothstep the
 * fill worklet applies, so a caller animating alongside the heart tracks the
 * actual surface rather than raw elapsed time — the liquid does not start
 * rising until the stream has had time to land.
 */
export function pourFillAt(t: number): number {
  const eased = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
  const raw = Math.min(Math.max((eased - 0.15) / 0.85, 0), 1);
  return raw * raw * (3 - 2 * raw);
}

/**
 * A drag contributes the same two quantities the motion sensors do, so the
 * gesture and the gyroscope drive one shared physics model instead of two
 * competing animations. Holding the heart over leans the surface; how fast it
 * is thrown is what actually raises a wave.
 */
export type LiquidDrag = {
  dragAngle: SharedValue<number>;
  dragLateral: SharedValue<number>;
};

const RELEASE_SPRING = { damping: 16, stiffness: 150 } as const;

export function useLiquidDrag(
  enabled: boolean,
): LiquidDrag & { gesture: ReturnType<typeof Gesture.Pan> } {
  const dragAngle = useSharedValue(0);
  const dragLateral = useSharedValue(0);
  const gesture = useMemo(
    () =>
      Gesture.Pan()
        .enabled(enabled)
        .activeOffsetX([-12, 12])
        .failOffsetY([-16, 16])
        .onUpdate((event) => {
          const motion = dragToMotion(event.translationX, event.velocityX);
          dragAngle.value = motion.gravityAngle;
          dragLateral.value = motion.lateral;
        })
        .onFinalize((event) => {
          // Releasing hands the liquid back to gravity, and the flick's parting
          // speed keeps forcing it for a beat so the release throws a wave.
          dragAngle.value = withSpring(0, RELEASE_SPRING);
          dragLateral.value = dragToMotion(0, event.velocityX ?? 0).lateral;
          dragLateral.value = withTiming(0, { duration: 260, easing: Easing.out(Easing.quad) });
        }),
    [enabled, dragAngle, dragLateral],
  );
  return { dragAngle, dragLateral, gesture };
}

