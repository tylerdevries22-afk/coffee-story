import { Circle, Path, Skia } from '@shopify/react-native-skia';
import { useDerivedValue, type SharedValue } from 'react-native-reanimated';

import type { GlassCupPalette } from './glass-cup-palettes';
import { churnWorklet, type CupGeometry } from './glass-cup-geometry';

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


export function GlassCupParticles({ animate, master, pour, surfaceY, staticSurface, geo, palette }: {
  animate: boolean;
  master: SharedValue<number>;
  pour: SharedValue<number>;
  surfaceY: SharedValue<number>;
  staticSurface: number;
  geo: CupGeometry;
  palette: GlassCupPalette;
}) {
  return (
    <>
      {animate
        ? SPARKLES.map((sp) => <Sparkle key={sp.seed} sp={sp} master={master} surfaceY={surfaceY} geo={geo} palette={palette} />)
        : SPARKLES.slice(0, 8).map((sp) => <StaticSparkle key={sp.seed} sp={sp} surface={staticSurface} geo={geo} palette={palette} />)}
      {animate
        ? BUBBLES.map((b) => <Bubble key={b.seed} b={b} master={master} pour={pour} surfaceY={surfaceY} geo={geo} />)
        : null}
    </>
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
  geo: CupGeometry;
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
  geo: CupGeometry;
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
  geo: CupGeometry;
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
