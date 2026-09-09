import { useEffect } from 'react';
import { Skia } from '@shopify/react-native-skia';
import {
  cancelAnimation, Easing, useDerivedValue, useFrameCallback, useSharedValue,
  withRepeat, withSequence, withTiming,
} from 'react-native-reanimated';

import { REST_SLOSH, stepSlosh, type SloshState } from './liquid-physics';
import { POUR_MS, type LiquidDrag } from './liquid-drag';
import {
  buildLiquidPath, churnWorklet, fillProgressWorklet, type CupGeometry,
} from './glass-cup-geometry';
import { useLiquidMotion } from './use-liquid-motion';

const MASTER_MS = 7600;

type AnimationParams = {
  animate: boolean;
  target: number;
  geo: CupGeometry;
  drag?: LiquidDrag;
  replayKey?: string | number;
};

export function useGlassCupAnimation({ animate, target, geo, drag, replayKey }: AnimationParams) {
  const { k, width, height, cupTop, cupBottom, centerX, centerY } = geo;
  const span = cupBottom - cupTop;

  const pour = useSharedValue(animate ? 0 : 1);
  const master = useSharedValue(0);
  const nebulaSpin = useSharedValue(0);
  const settle = useSharedValue(animate ? 0 : 1);
  const idleAngle = useSharedValue(0);
  const idleLateral = useSharedValue(0);
  const dragAngle = drag?.dragAngle ?? idleAngle;
  const dragLateral = drag?.dragLateral ?? idleLateral;

  // Gyroscope and drag add: on hardware the liquid answers to how the phone is
  // held AND to being pushed, and on a simulator only the drag term is ever
  // non-zero. Row hearts (`decorated={false}`) skip the sensor entirely.
  const sensor = useLiquidMotion(animate);
  const slosh = useSharedValue<SloshState>(REST_SLOSH);

  useFrameCallback((frame) => {
    'worklet';
    const dt = (frame.timeSincePreviousFrame ?? 16) / 1000;
    // While the stream is still landing it stirs the liquid on its own, so the
    // pour reads as poured rather than as a level that simply rises.
    const pourStir = churnWorklet(pour.value) * 5 * Math.sin(2 * Math.PI * 3.1 * master.value);
    slosh.value = stepSlosh(slosh.value, {
      lateral: sensor.lateral.value + dragLateral.value + pourStir,
      gravityAngle: sensor.gravityAngle.value + dragAngle.value,
      dt,
    });
  }, animate);

  useEffect(() => {
    if (!animate) {
      pour.value = 1;
      settle.value = 1;
      return undefined;
    }
    pour.value = 0;
    settle.value = 0;
    pour.value = withTiming(1, { duration: POUR_MS, easing: Easing.inOut(Easing.quad) });
    settle.value = withSequence(
      withTiming(0, { duration: 2500 }),
      withTiming(1, { duration: 1500, easing: Easing.out(Easing.quad) }),
    );
    master.value = withRepeat(withTiming(1, { duration: MASTER_MS, easing: Easing.linear }), -1);
    nebulaSpin.value = withRepeat(withTiming(1, { duration: 32000, easing: Easing.linear }), -1);
    return () => {
      cancelAnimation(master);
      cancelAnimation(nebulaSpin);
      master.value = 0;
      nebulaSpin.value = 0;
    };
  }, [animate, target, replayKey, pour, master, nebulaSpin, settle]);

  // ----- Derived animation state (all phase-locked to the master clock) -----

  const surfaceY = useDerivedValue(() => {
    return cupTop + span * (1 - target * fillProgressWorklet(pour.value));
  }, [cupTop, span, target]);

  // The body carries only the interior decor (nebula, sparkles, bubbles) now.
  // The surface itself is shaped by the physics, so rotating the whole mass
  // would tilt the bottom of the liquid too — which real liquid never does.
  const liquidTransform = useDerivedValue(() => {
    return [{ rotate: slosh.value.tilt * 0.22 }];
  }, []);

  const liquidPath = useDerivedValue(
    () => buildLiquidPath(slosh.value, surfaceY.value, pour.value, master.value, geo, 0, 1),
    [geo],
  );
  const backWavePath = useDerivedValue(
    () =>
      buildLiquidPath(
        slosh.value,
        surfaceY.value - 1.2 * k,
        pour.value,
        master.value,
        geo,
        Math.PI * 0.7,
        1.5,
      ),
    [geo, k],
  );

  const nebulaOpacityA = useDerivedValue(() => 0.55 * fillProgressWorklet(pour.value), []);
  const nebulaOpacityB = useDerivedValue(() => 0.38 * fillProgressWorklet(pour.value), []);
  const nebulaTransformA = useDerivedValue(() => {
    return [{ rotate: 2 * Math.PI * nebulaSpin.value }, { scale: 1 + 0.06 * Math.sin(2 * Math.PI * master.value) }];
  }, []);
  const nebulaTransformB = useDerivedValue(() => {
    return [{ rotate: -2 * Math.PI * nebulaSpin.value - 1.1 }, { scale: 1.3 }];
  }, []);

  const nebulaClipRect = useDerivedValue(() => {
    return Skia.XYWHRect(0, surfaceY.value + 1 * k, width, height);
  }, [width, height, k]);

  // Pour stream — enters from above the lid (canvas top), lands at the surface.
  const streamGate = useDerivedValue(() => {
    if (!animate) return 0;
    const p = pour.value;
    return p < 0.07 ? p / 0.07 : p > 0.85 ? Math.max(0, (0.96 - p) / 0.11) : 1;
  }, [animate]);
  const streamPath = useDerivedValue(() => {
    const p = Skia.Path.Make();
    if (streamGate.value <= 0.01) return p;
    const wiggle = Math.sin(2 * Math.PI * 8 * master.value) * 0.6 * k * churnWorklet(pour.value);
    const x = centerX + wiggle;
    const w = 5.4 * k * (0.65 + 0.35 * streamGate.value);
    p.addRRect(Skia.RRectXY(Skia.XYWHRect(x - w / 2, 0, w, Math.max(surfaceY.value + 2 * k, 0)), w / 2, w / 2));
    return p;
  }, [centerX, k]);
  const streamCorePath = useDerivedValue(() => {
    const p = Skia.Path.Make();
    if (streamGate.value <= 0.01) return p;
    const wiggle = Math.sin(2 * Math.PI * 8 * master.value) * 0.6 * k * churnWorklet(pour.value);
    const x = centerX + wiggle;
    const w = 2.2 * k;
    p.addRRect(Skia.RRectXY(Skia.XYWHRect(x - w / 2, 0, w, Math.max(surfaceY.value + 1 * k, 0)), w / 2, w / 2));
    return p;
  }, [centerX, k]);
  const streamOpacity = useDerivedValue(() => streamGate.value * 0.9, []);
  const streamCoreOpacity = useDerivedValue(() => streamGate.value * 0.8, []);

  const shimmerTransform = useDerivedValue(() => {
    const w = Math.max(0, Math.sin(2 * Math.PI * (master.value - 0.25)));
    return [{ translateX: -width * 0.7 + w * width * 1.6 }, { rotate: 0.32 }];
  }, [width]);
  const shimmerOpacity = useDerivedValue(() => {
    const w = Math.max(0, Math.sin(2 * Math.PI * (master.value - 0.25)));
    return animate ? w * 0.16 : 0;
  }, [animate]);

  const staticSurface = cupTop + span * (1 - target);

  return {
    pour, master, surfaceY, liquidTransform, liquidPath, backWavePath,
    nebulaOpacityA, nebulaOpacityB, nebulaTransformA, nebulaTransformB,
    nebulaClipRect, streamPath, streamCorePath, streamOpacity,
    streamCoreOpacity, shimmerTransform, shimmerOpacity, staticSurface,
  };
}
