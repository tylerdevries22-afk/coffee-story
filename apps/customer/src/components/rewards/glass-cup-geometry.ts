import { Skia } from '@shopify/react-native-skia';

import { sloshEnergy, surfaceOffsetAt, type SloshState } from './liquid-physics';

// One seamless takeaway-cup path in the same 116x106 design box: a lid band
// with a slight overhang, a gently tapered body and a rounded base. Rendering
// in a single Skia canvas removes the composite-clip seams entirely.
export function makeCupPath(k: number, topExt: number) {
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

export function geometryFor(size: number, decorated: boolean) {
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

export function fillProgressWorklet(pour: number): number {
  'worklet';
  const raw = Math.min(Math.max((pour - 0.15) / 0.85, 0), 1);
  return raw * raw * (3 - 2 * raw);
}

export function churnWorklet(pour: number): number {
  'worklet';
  return Math.sin(Math.PI * Math.min(Math.max(pour, 0), 1));
}

export type CupGeometry = ReturnType<typeof geometryFor>;

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
export function buildLiquidPath(
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
