import { useMemo } from 'react';
import { View } from 'react-native';

import { useReducedMotion } from '@platform/ui';
import type { RewardTierName } from '@platform/domain';

import { geometryFor } from './glass-cup-geometry';
import { paletteForTier } from './glass-cup-palettes';
import { GlassCupScene } from './glass-cup-scene';
import type { LiquidDrag } from './liquid-drag';

export { POUR_MS, pourFillAt, useLiquidDrag, type LiquidDrag } from './liquid-drag';

export type GlassCupProps = {
  size?: number;
  fillPercent: number;
  tier: RewardTierName;
  decorated?: boolean;
  drag?: LiquidDrag;
  /** Changing this replays the pour from empty. */
  replayKey?: string | number;
  accessibilityLabel?: string;
};

export function GlassCup({
  size = 116, fillPercent, tier, decorated = true, drag, replayKey, accessibilityLabel,
}: GlassCupProps) {
  const reducedMotion = useReducedMotion();
  const animate = decorated && !reducedMotion;
  const target = Math.max(0, Math.min(fillPercent, 1));
  const palette = paletteForTier(tier);
  const geo = useMemo(() => geometryFor(size, decorated), [size, decorated]);
  return (
    <View
      accessibilityRole="image"
      accessibilityLabel={accessibilityLabel ?? `${Math.round(target * 100)} percent full`}
      style={{ width: geo.width, height: geo.height }}
    >
      <GlassCupScene
        geo={geo}
        target={target}
        palette={palette}
        animate={animate}
        drag={drag}
        replayKey={replayKey}
      />
    </View>
  );
}
