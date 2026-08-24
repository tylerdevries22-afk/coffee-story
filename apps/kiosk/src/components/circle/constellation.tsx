import { useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';

import type { KioskEntryNode } from '@platform/domain';
import { menuImageFrame, type MenuImageVariant } from '@platform/ui';

import { CircleTile } from '@/components/circle/circle-tile';
import { layoutConstellation } from '@/features/constellation';
import type { BundledArt } from '@/imagery/resolve-image';

const VARIANT_FOR: Record<KioskEntryNode['emphasis'], MenuImageVariant> = {
  hero: 'kioskHero',
  standard: 'kioskNode',
  minor: 'kioskMinor',
};

/**
 * The first screen's circles, absolutely positioned from computed geometry.
 *
 * Measured rather than assumed: the layout is a function of the real canvas, so
 * the same config draws correctly on an iPad and in the 1366x1024 web export
 * `scripts/capture-surfaces.mjs` drives. Nothing renders until the measurement
 * lands, which avoids a first frame at the wrong size that the entrance
 * animation would then animate away from.
 */
export function Constellation({
  nodes,
  monogram,
  bundled,
  onSelect,
}: {
  nodes: readonly KioskEntryNode[];
  monogram?: string | null;
  bundled?: BundledArt;
  onSelect: (node: KioskEntryNode) => void;
}) {
  const [canvas, setCanvas] = useState<{ width: number; height: number } | null>(null);

  function measure(event: LayoutChangeEvent) {
    const { width, height } = event.nativeEvent.layout;
    setCanvas((current) =>
      current && current.width === width && current.height === height ? current : { width, height });
  }

  const placed = canvas
    ? layoutConstellation(nodes.map((node) => ({ id: node.id, emphasis: node.emphasis })), canvas)
    : [];
  const byId = new Map(nodes.map((node) => [node.id, node]));

  return (
    <View style={styles.canvas} onLayout={measure}>
      {placed.map((circle) => {
        const node = byId.get(circle.id);
        if (!node) return null;
        const variant = VARIANT_FOR[node.emphasis];
        const frame = menuImageFrame(variant);
        const size = frame.kind === 'fixed' ? frame.size : circle.size;
        return (
          <View
            key={node.id}
            style={[styles.slot, { left: circle.x - size / 2, top: circle.y - size / 2 }]}
          >
            <CircleTile
              label={node.label}
              caption={node.caption}
              variant={variant}
              index={circle.index}
              request={{ imageSlug: node.imageSlug, monogram, label: node.label }}
              bundled={bundled}
              onPress={() => onSelect(node)}
            />
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  canvas: { flex: 1 },
  slot: { position: 'absolute' },
});
