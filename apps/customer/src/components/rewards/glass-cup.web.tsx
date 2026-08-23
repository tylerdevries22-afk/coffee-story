import { useEffect, useMemo } from 'react';
import { View } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedProps,
  useFrameCallback,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import Svg, { ClipPath, Defs, LinearGradient, Path, Stop } from 'react-native-svg';

import type { RewardTierName } from '@platform/domain';
import { useReducedMotion } from '@/hooks/use-reduced-motion';

import { paletteForTier } from './glass-cup-palettes';
import { REST_SLOSH, sloshEnergy, stepSlosh, surfaceOffsetAt, type SloshState } from './liquid-physics';
import { POUR_MS, type LiquidDrag } from './liquid-drag';

export { POUR_MS, pourFillAt, useLiquidDrag, type LiquidDrag } from './liquid-drag';

/**
 * Web rendering of the rewards glass cup.
 *
 * Skia has no renderer in the browser unless CanvasKit's ~3 MB WASM bundle is
 * fetched first, which is the wrong trade for a demo whose whole promise is
 * "opens instantly on any phone". SVG draws the same shape for a few kilobytes.
 *
 * The liquid is still physically simulated: this shares `liquid-physics` with
 * the native renderer, so the surface finds level, sloshes and settles exactly
 * as it does on device. What web gives up is decoration only — the nebula
 * texture, sparkles and bubbles — not the behaviour.
 */
const AnimatedPath = Animated.createAnimatedComponent(Path);

/** Design box shared with the native renderer, so both agree on proportions. */
const BOX_W = 116;
const BOX_H = 106;

const CUP_D =
  'M12,6 L104,6 C106.5,6 108,8 108,10.5 L108,20 L96,20 ' +
  'C95,48 91,74 88,92 C87,99 83,103 76,103 L40,103 ' +
  'C33,103 29,99 28,92 C25,74 21,48 20,20 L8,20 L8,10.5 C8,8 9.5,6 12,6 Z';

export type GlassCupProps = {
  size?: number;
  fillPercent: number;
  tier: RewardTierName;
  decorated?: boolean;
  drag?: LiquidDrag;
  replayKey?: string | number;
  accessibilityLabel?: string;
};

function fillProgress(pour: number): number {
  'worklet';
  const raw = Math.min(Math.max((pour - 0.15) / 0.85, 0), 1);
  return raw * raw * (3 - 2 * raw);
}

export function GlassCup({
  size = 116,
  fillPercent,
  tier,
  decorated = true,
  drag,
  replayKey,
  accessibilityLabel,
}: GlassCupProps) {
  const reducedMotion = useReducedMotion();
  const animate = decorated && !reducedMotion;
  const target = Math.max(0, Math.min(fillPercent, 1));
  const palette = paletteForTier(tier);
  const height = Math.round((size * BOX_H) / BOX_W);

  const pour = useSharedValue(animate ? 0 : 1);
  const master = useSharedValue(0);
  const slosh = useSharedValue<SloshState>(REST_SLOSH);
  const idleAngle = useSharedValue(0);
  const idleLateral = useSharedValue(0);
  const dragAngle = drag?.dragAngle ?? idleAngle;
  const dragLateral = drag?.dragLateral ?? idleLateral;

  useFrameCallback((frame) => {
    'worklet';
    const dt = (frame.timeSincePreviousFrame ?? 16) / 1000;
    slosh.value = stepSlosh(slosh.value, {
      lateral: dragLateral.value,
      gravityAngle: dragAngle.value,
      dt,
    });
  }, animate);

  useEffect(() => {
    if (!animate) {
      pour.value = 1;
      return undefined;
    }
    pour.value = 0;
    pour.value = withTiming(1, { duration: POUR_MS, easing: Easing.inOut(Easing.quad) });
    master.value = withRepeat(withTiming(1, { duration: 7600, easing: Easing.linear }), -1);
    return () => {
      cancelAnimation(master);
      master.value = 0;
    };
  }, [animate, target, replayKey, pour, master]);

  // The liquid body: a wave-topped area closed off below the cup, clipped back
  // to the cup outline. Authored in design-box units so the SVG viewBox scales it.
  const liquidProps = useAnimatedProps(() => {
    const level = 6 + (103 - 6) * (1 - target * fillProgress(pour.value));
    const state = slosh.value;
    const energy = sloshEnergy(state);
    const ripple = 0.6 + energy * 3;
    const steps = 20;
    let d = `M-20,${level}`;
    for (let i = 0; i <= steps; i += 1) {
      const t = i / steps;
      const x = -20 + 156 * t;
      const u = (x - BOX_W / 2) / BOX_W;
      const y =
        level +
        surfaceOffsetAt(u, state) * BOX_W +
        Math.sin(2 * Math.PI * (2.6 * master.value + t * 1.8)) * ripple;
      d += ` L${x.toFixed(2)},${y.toFixed(2)}`;
    }
    d += ` L136,${BOX_H + 10} L-20,${BOX_H + 10} Z`;
    return { d };
  }, [target]);

  const gradientId = useMemo(() => `cs-liquid-${tier}`, [tier]);
  const clipId = useMemo(() => `cs-cup-${tier}-${size}`, [tier, size]);

  return (
    <View
      accessibilityRole="image"
      accessibilityLabel={accessibilityLabel}
      style={{ width: size, height }}
    >
      <Svg width={size} height={height} viewBox={`0 0 ${BOX_W} ${BOX_H}`}>
        <Defs>
          <ClipPath id={clipId}>
            <Path d={CUP_D} />
          </ClipPath>
          <LinearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={palette.liquidLight} />
            <Stop offset="1" stopColor={palette.liquidDeep} />
          </LinearGradient>
        </Defs>
        {/* Empty glass behind the liquid, so an unfilled cup still reads. */}
        <Path d={CUP_D} fill={palette.waveBack} opacity={0.22} />
        <AnimatedPath animatedProps={liquidProps} fill={`url(#${gradientId})`} clipPath={`url(#${clipId})`} />
        {/* Rim, drawn last so the liquid never spills over the outline. */}
        <Path d={CUP_D} fill="none" stroke="rgba(255,255,255,0.75)" strokeWidth={2.5} />
      </Svg>
    </View>
  );
}
