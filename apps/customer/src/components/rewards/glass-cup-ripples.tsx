import { Path, Skia } from '@shopify/react-native-skia';
import { useDerivedValue, type SharedValue } from 'react-native-reanimated';

import type { GlassCupPalette } from './glass-cup-palettes';
import { churnWorklet, type CupGeometry } from './glass-cup-geometry';

export function Ripples({
  master,
  pour,
  surfaceY,
  geo,
  palette,
}: {
  master: SharedValue<number>;
  pour: SharedValue<number>;
  surfaceY: SharedValue<number>;
  geo: CupGeometry;
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
