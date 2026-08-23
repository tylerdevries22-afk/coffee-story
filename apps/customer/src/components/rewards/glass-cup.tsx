import {
  BlurMask,
  Canvas,
  Circle,
  Group,
  Image as SkiaImage,
  LinearGradient as SkiaLinearGradient,
  Path,
  RadialGradient,
  Rect,
  RoundedRect,
  Skia,
  useImage,
  vec,
} from '@shopify/react-native-skia';
import { useEffect, useMemo } from 'react';
import { View } from 'react-native';
import {
  cancelAnimation,
  Easing,
  useDerivedValue,
  useFrameCallback,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

import type { RewardTierName } from '@platform/domain';
import { useReducedMotion } from '@/hooks/use-reduced-motion';

import { paletteForTier, type GlassCupPalette } from './glass-cup-palettes';
import {
  REST_SLOSH,
  sloshEnergy,
  stepSlosh,
  surfaceOffsetAt,
  type SloshState,
} from './liquid-physics';
import { useLiquidMotion } from './use-liquid-motion';

import NEBULA from '../../../assets/rewards/liquid-nebula.webp';

import { POUR_MS, type LiquidDrag } from './liquid-drag';

// One seamless takeaway-cup path in the same 116x106 design box: a lid band
// with a slight overhang, a gently tapered body and a rounded base. Rendering
// in a single Skia canvas removes the composite-clip seams entirely.
function makeCupPath(k: number, topExt: number) {
  const p = Skia.Path.Make();
  const s = (x: number, y: number) => [x * k, y * k + topExt] as const;
  const move = s(12, 6);
  p.moveTo(move[0], move[1]);
  let l = s(104, 6);
  p.lineTo(l[0], l[1]);
  let c = [...s(106.5, 6), ...s(108, 8), ...s(108, 10.5)];
  p.cubicTo(c[0], c[1], c[2], c[3], c[4], c[5]);
  l = s(108, 20);
  p.lineTo(l[0], l[1]);
  l = s(96, 20);
  p.lineTo(l[0], l[1]);
  c = [...s(95, 48), ...s(91, 74), ...s(88, 92)];
  p.cubicTo(c[0], c[1], c[2], c[3], c[4], c[5]);
  c = [...s(87, 99), ...s(83, 103), ...s(76, 103)];
  p.cubicTo(c[0], c[1], c[2], c[3], c[4], c[5]);
  l = s(40, 103);
  p.lineTo(l[0], l[1]);
  c = [...s(33, 103), ...s(29, 99), ...s(28, 92)];
  p.cubicTo(c[0], c[1], c[2], c[3], c[4], c[5]);
  c = [...s(25, 74), ...s(21, 48), ...s(20, 20)];
  p.cubicTo(c[0], c[1], c[2], c[3], c[4], c[5]);
  l = s(8, 20);
  p.lineTo(l[0], l[1]);
  l = s(8, 10.5);
  p.lineTo(l[0], l[1]);
  c = [...s(8, 8), ...s(9.5, 6), ...s(12, 6)];
  p.cubicTo(c[0], c[1], c[2], c[3], c[4], c[5]);
  p.close();
  return p;
}

function geometryFor(size: number, decorated: boolean) {
  const k = size / 116;
  const topExt = decorated ? 26 * k : 0;
  return {
    k,
    topExt,
    width: 116 * k,
    height: 106 * k + topExt,
    cupTop: 6 * k + topExt,
    cupBottom: 103 * k + topExt,
    centerX: 58 * k,
    centerY: 54 * k + topExt,
  };
}

function fillProgressWorklet(pour: number): number {
  'worklet';
  const raw = Math.min(Math.max((pour - 0.15) / 0.85, 0), 1);
  return raw * raw * (3 - 2 * raw);
}

function churnWorklet(pour: number): number {
  'worklet';
  return Math.sin(Math.PI * Math.min(Math.max(pour, 0), 1));
}

type CupGeometry = ReturnType<typeof geometryFor>;

/**
 * Closes the liquid body under a free surface shaped by the sloshing model.
 *
 * The surface is sampled across a span wider than the heart so the body still
 * covers the lobes once it tilts, then dropped to below the canvas and closed —
 * the heart path clips it back to shape.
 *
 * `rippleGain` scales the fine chop layered over the physical modes. That chop
 * is cosmetic surface tension detail, not simulated: it is gated on how
 * agitated the liquid actually is, so a settled surface is genuinely still.
 */
function buildLiquidPath(
  state: SloshState,
  surface: number,
  pour: number,
  master: number,
  geo: CupGeometry,
  phaseShift: number,
  rippleGain: number,
) {
  'worklet';
  const { k, width, height, centerX } = geo;
  const p = Skia.Path.Make();
  const energy = sloshEnergy(state);
  const churn = churnWorklet(pour);
  const ripple = (0.5 + churn * 2.4 + energy * 2.6) * rippleGain * k;
  const left = -width * 0.2;
  const span = width * 1.4;
  const steps = 22;
  p.moveTo(left, surface);
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    const x = left + span * t;
    // The across-container coordinate the mode shapes are defined on.
    const u = (x - centerX) / width;
    const y =
      surface +
      surfaceOffsetAt(u, state) * width +
      Math.sin(phaseShift + 2 * Math.PI * (2.6 * master + t * 1.8)) * ripple;
    p.lineTo(x, y);
  }
  p.lineTo(width * 1.2, height + 10 * k);
  p.lineTo(left, height + 10 * k);
  p.close();
  return p;
}

export { POUR_MS, pourFillAt, useLiquidDrag, type LiquidDrag } from './liquid-drag';

export type GlassCupProps = {
  size?: number;
  fillPercent: number;
  tier: RewardTierName;
  decorated?: boolean;
  drag?: LiquidDrag;
  /**
   * Changing this replays the pour from empty. The demo tier switch can leave
   * the fill percentage untouched while everything else about the tier changes,
   * and the liquid is meant to pour again alongside the counter each time.
   */
  replayKey?: string | number;
  accessibilityLabel?: string;
};

const SPARKLES = [
  { seed: 0.05, x: 0.32, yBias: 0.2, size: 2.2, diamond: true },
  { seed: 0.14, x: 0.6, yBias: 0.34, size: 1.6, diamond: false },
  { seed: 0.26, x: 0.45, yBias: 0.55, size: 2.6, diamond: true },
  { seed: 0.35, x: 0.7, yBias: 0.16, size: 1.8, diamond: false },
  { seed: 0.44, x: 0.25, yBias: 0.45, size: 1.7, diamond: true },
  { seed: 0.53, x: 0.54, yBias: 0.72, size: 2.1, diamond: false },
  { seed: 0.62, x: 0.38, yBias: 0.3, size: 2.8, diamond: true },
  { seed: 0.71, x: 0.66, yBias: 0.5, size: 1.6, diamond: false },
  { seed: 0.8, x: 0.5, yBias: 0.1, size: 1.9, diamond: true },
  { seed: 0.87, x: 0.33, yBias: 0.64, size: 1.7, diamond: false },
  { seed: 0.93, x: 0.58, yBias: 0.42, size: 2.3, diamond: true },
  { seed: 0.98, x: 0.47, yBias: 0.85, size: 1.5, diamond: false },
] as const;

const BUBBLES = [
  { seed: 0.0, x: 0.44, rise: 26, size: 1.6 },
  { seed: 0.16, x: 0.55, rise: 34, size: 1.2 },
  { seed: 0.31, x: 0.49, rise: 22, size: 1.9 },
  { seed: 0.47, x: 0.6, rise: 30, size: 1.3 },
  { seed: 0.6, x: 0.4, rise: 36, size: 1.1 },
  { seed: 0.74, x: 0.52, rise: 24, size: 1.7 },
  { seed: 0.88, x: 0.46, rise: 31, size: 1.4 },
] as const;

// Master clock period — every periodic effect runs at an integer multiple of
// this frequency, so the combined idle motion loops seamlessly with no drift.
const MASTER_MS = 7600;

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
  const geo = useMemo(() => geometryFor(size, decorated), [size, decorated]);
  const cupPath = useMemo(() => makeCupPath(geo.k, geo.topExt), [geo]);
  const nebulaImage = useImage(NEBULA);

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

  return (
    <View
      accessibilityRole="image"
      accessibilityLabel={accessibilityLabel ?? `${Math.round(target * 100)} percent full`}
      style={{ width, height }}
    >
      <Canvas style={{ width, height }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {/* ---- Glass shell (behind the liquid) ---- */}
        <Path path={cupPath} color="rgba(255,255,255,0.10)" />
        <Path path={cupPath}>
          <SkiaLinearGradient
            start={vec(centerX, cupTop)}
            end={vec(centerX, cupBottom)}
            colors={['rgba(255,255,255,0.30)', 'rgba(255,255,255,0.02)']}
          />
        </Path>

        {/* ---- Liquid, clipped to one seamless cup path ---- */}
        <Group clip={cupPath}>
          <Group transform={liquidTransform} origin={vec(centerX, centerY)}>
            <Path path={backWavePath} color={palette.waveBack} opacity={0.55} />
            <Path path={liquidPath}>
              <SkiaLinearGradient
                start={vec(centerX, cupTop)}
                end={vec(centerX, cupBottom + 6 * k)}
                colors={[palette.liquidLight, palette.liquidMid, palette.liquidDeep]}
                positions={[0, 0.4, 1]}
              />
            </Path>
            {/* caustic glow near the bottom of the liquid */}
            <Circle cx={centerX} cy={cupBottom - 8 * k} r={26 * k} opacity={0.3}>
              <RadialGradient
                c={vec(centerX, cupBottom - 8 * k)}
                r={26 * k}
                colors={[palette.liquidLight, 'rgba(255,255,255,0)']}
              />
            </Circle>

            {/* starry nebula, screen-blended inside the liquid */}
            {nebulaImage ? (
              <Group clip={nebulaClipRect}>
                <Group transform={nebulaTransformA} origin={vec(centerX, centerY + 8 * k)} blendMode="screen" opacity={nebulaOpacityA}>
                  <SkiaImage image={nebulaImage} x={centerX - width * 0.75} y={centerY - width * 0.55} width={width * 1.5} height={width * 1.5} fit="cover" />
                </Group>
                <Group transform={nebulaTransformB} origin={vec(centerX, centerY + 16 * k)} blendMode="screen" opacity={nebulaOpacityB}>
                  <SkiaImage image={nebulaImage} x={centerX - width * 0.75} y={centerY - width * 0.35} width={width * 1.5} height={width * 1.5} fit="cover" />
                </Group>
              </Group>
            ) : null}

            {/* glitter */}
            {animate
              ? SPARKLES.map((sp) => (
                  <Sparkle key={sp.seed} sp={sp} master={master} surfaceY={surfaceY} geo={geo} palette={palette} />
                ))
              : SPARKLES.slice(0, 8).map((sp) => (
                  <StaticSparkle key={sp.seed} sp={sp} surface={staticSurface} geo={geo} palette={palette} />
                ))}

            {/* bubbles during the pour */}
            {animate
              ? BUBBLES.map((b) => <Bubble key={b.seed} b={b} master={master} pour={pour} surfaceY={surfaceY} geo={geo} />)
              : null}
          </Group>

          {/* splash ripples where the stream lands (not tilted with liquid) */}
          {animate ? <Ripples master={master} pour={pour} surfaceY={surfaceY} geo={geo} palette={palette} /> : null}

          {/* shimmer sweep across the glass */}
          <Group transform={shimmerTransform} origin={vec(centerX, centerY)}>
            <Rect x={centerX - 9 * k} y={cupTop - 20 * k} width={14 * k} height={height} color="white" opacity={shimmerOpacity}>
              <BlurMask blur={7 * k} style="normal" />
            </Rect>
          </Group>

          {/* inner shadow for curved depth */}
          <Path path={cupPath} style="stroke" strokeWidth={5 * k} color="rgba(20,10,40,0.16)">
            <BlurMask blur={4 * k} style="normal" />
          </Path>
        </Group>

        {/* ---- Pour stream (drawn unclipped so it starts above the glass) ---- */}
        {animate ? (
          <>
            <Path path={streamPath} opacity={streamOpacity}>
              <SkiaLinearGradient
                start={vec(centerX, 0)}
                end={vec(centerX, height * 0.8)}
                colors={[palette.streamLight, palette.streamDeep]}
              />
            </Path>
            <Path path={streamCorePath} color="rgba(255,255,255,0.75)" opacity={streamCoreOpacity}>
              <BlurMask blur={1.2 * k} style="normal" />
            </Path>
          </>
        ) : null}

        {/* ---- Glass front: rim + speculars ---- */}
        <Path path={cupPath} style="stroke" strokeWidth={1.7 * k}>
          <SkiaLinearGradient
            start={vec(centerX, cupTop)}
            end={vec(centerX, cupBottom)}
            colors={['rgba(255,255,255,0.9)', 'rgba(255,255,255,0.22)']}
          />
        </Path>
        <Group transform={[{ rotate: -0.66 }]} origin={vec(32 * k, 30 * k + geo.topExt)}>
          <RoundedRect x={22 * k} y={26 * k + geo.topExt} width={20 * k} height={7 * k} r={4 * k} color="rgba(255,255,255,0.55)">
            <BlurMask blur={2.5 * k} style="normal" />
          </RoundedRect>
        </Group>
        <Circle cx={26 * k} cy={34 * k + geo.topExt} r={2.6 * k} color="rgba(255,255,255,0.6)">
          <BlurMask blur={1.6 * k} style="normal" />
        </Circle>
        <Path
          path={`M ${84 * k} ${26 * k + geo.topExt} C ${92 * k} ${34 * k + geo.topExt} ${94 * k} ${48 * k + geo.topExt} ${90 * k} ${62 * k + geo.topExt}`}
          style="stroke"
          strokeWidth={2.4 * k}
          color="rgba(255,255,255,0.22)"
        >
          <BlurMask blur={2 * k} style="normal" />
        </Path>
      </Canvas>
    </View>
  );
}

function Sparkle({
  sp,
  master,
  surfaceY,
  geo,
  palette,
}: {
  sp: (typeof SPARKLES)[number];
  master: SharedValue<number>;
  surfaceY: SharedValue<number>;
  geo: ReturnType<typeof geometryFor>;
  palette: GlassCupPalette;
}) {
  const { k, width, cupBottom } = geo;
  const opacity = useDerivedValue(() => {
    const tw = 0.5 + 0.5 * Math.sin(2 * Math.PI * (2 * master.value + sp.seed));
    const below = surfaceY.value < cupBottom - 6 * k ? 1 : 0;
    return tw * 0.85 * below;
  }, [sp, k, cupBottom]);
  const cy = useDerivedValue(() => {
    const s = surfaceY.value;
    const depth = Math.max(cupBottom - s - 8 * k, 0);
    return s + 5 * k + sp.yBias * depth + Math.sin(2 * Math.PI * (master.value + sp.seed)) * 2 * k;
  }, [sp, k, cupBottom]);
  const cx = sp.x * width;
  const r = sp.size * k;
  const diamondPath = useDerivedValue(() => {
    const p = Skia.Path.Make();
    if (!sp.diamond) return p;
    const y = cy.value;
    p.moveTo(cx, y - r * 1.6);
    p.lineTo(cx + r, y);
    p.lineTo(cx, y + r * 1.6);
    p.lineTo(cx - r, y);
    p.close();
    return p;
  }, [cx, r, sp.diamond]);
  if (sp.diamond) {
    return <Path path={diamondPath} color={palette.sparkle} opacity={opacity} />;
  }
  return <Circle cx={cx} cy={cy} r={r} color={palette.sparkle} opacity={opacity} />;
}

function StaticSparkle({
  sp,
  surface,
  geo,
  palette,
}: {
  sp: (typeof SPARKLES)[number];
  surface: number;
  geo: ReturnType<typeof geometryFor>;
  palette: GlassCupPalette;
}) {
  const { k, width, cupBottom } = geo;
  const depth = Math.max(cupBottom - surface - 8 * k, 0);
  const cy = surface + 5 * k + sp.yBias * depth;
  return <Circle cx={sp.x * width} cy={cy} r={sp.size * k * 0.9} color={palette.sparkle} opacity={0.5} />;
}

function Bubble({
  b,
  master,
  pour,
  surfaceY,
  geo,
}: {
  b: (typeof BUBBLES)[number];
  master: SharedValue<number>;
  pour: SharedValue<number>;
  surfaceY: SharedValue<number>;
  geo: ReturnType<typeof geometryFor>;
}) {
  const { k, width, cupBottom } = geo;
  const opacity = useDerivedValue(() => {
    const p = (4 * master.value + b.seed) % 1;
    return Math.sin(Math.PI * p) * 0.65 * churnWorklet(pour.value);
  }, [b]);
  const cy = useDerivedValue(() => {
    const p = (4 * master.value + b.seed) % 1;
    const base = Math.min(surfaceY.value + (cupBottom - surfaceY.value) * 0.75, cupBottom - 4 * k);
    return base - p * b.rise * k;
  }, [b, k, cupBottom]);
  const cx = useDerivedValue(() => {
    const p = (4 * master.value + b.seed) % 1;
    return b.x * width + Math.sin(p * Math.PI * 3) * 1.6 * k;
  }, [b, width, k]);
  return <Circle cx={cx} cy={cy} r={b.size * k} color="rgba(255,255,255,0.8)" opacity={opacity} />;
}

function Ripples({
  master,
  pour,
  surfaceY,
  geo,
  palette,
}: {
  master: SharedValue<number>;
  pour: SharedValue<number>;
  surfaceY: SharedValue<number>;
  geo: ReturnType<typeof geometryFor>;
  palette: GlassCupPalette;
}) {
  const { k, centerX } = geo;
  return (
    <>
      {[0, 1 / 3, 2 / 3].map((offset) => (
        <Ripple key={offset} offset={offset} master={master} pour={pour} surfaceY={surfaceY} k={k} centerX={centerX} color={palette.foam} />
      ))}
    </>
  );
}

function Ripple({
  offset,
  master,
  pour,
  surfaceY,
  k,
  centerX,
  color,
}: {
  offset: number;
  master: SharedValue<number>;
  pour: SharedValue<number>;
  surfaceY: SharedValue<number>;
  k: number;
  centerX: number;
  color: string;
}) {
  const path = useDerivedValue(() => {
    const p = Skia.Path.Make();
    const t = (8 * master.value + offset) % 1;
    const rx = (4 + t * 16) * k;
    const ry = rx * 0.32;
    p.addOval(Skia.XYWHRect(centerX - rx, surfaceY.value - ry, rx * 2, ry * 2));
    return p;
  }, [offset, k, centerX]);
  const opacity = useDerivedValue(() => {
    const t = (8 * master.value + offset) % 1;
    return (1 - t) * 0.5 * churnWorklet(pour.value);
  }, [offset]);
  return <Path path={path} style="stroke" strokeWidth={1.3 * k} color={color} opacity={opacity} />;
}
