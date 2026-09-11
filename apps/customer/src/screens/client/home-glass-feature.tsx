import { LinearGradient } from 'expo-linear-gradient';
import { useCallback, useMemo, useState } from 'react';
import { Animated, Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';

import { ProductCutout, type ProductCutoutSource } from '@/components/product-cutout';
import type { MenuItem } from '@/data/catalog';
import {
  GLASS_FEATURE_REST, glassParallaxRange, groundParallaxRange,
  shadowOpacityRange, shadowScaleRange,
} from '@/features/glass-feature';
import { ACTION_LABEL } from './home-content';
import { disabledState, useTokens as useBrandTokens } from '@platform/ui';
import { formatMoney } from '@platform/domain';

import { createHomeStyles } from './home-screen.styles';

type GlassMotion = {
  glass: Animated.AnimatedInterpolation<number> | number;
  ground: Animated.AnimatedInterpolation<number> | number;
  shadowScaleX: Animated.AnimatedInterpolation<number> | number;
  shadowOpacity: Animated.AnimatedInterpolation<number> | number;
};

/**
 * Four interpolations off the natively driven scroll position, or the designed
 * still frame.
 *
 * Memoised because each one is a node attached to that value: rebuilding four
 * per row on every parent render would churn native nodes for nothing.
 */
function useGlassMotion(
  scrollY: Animated.Value,
  rowY: number | null,
  viewportHeight: number,
  still: boolean,
): GlassMotion {
  return useMemo<GlassMotion>(() => {
    if (still || rowY === null) {
      return {
        glass: GLASS_FEATURE_REST.glassShift,
        ground: GLASS_FEATURE_REST.groundShift,
        shadowScaleX: GLASS_FEATURE_REST.shadowScaleX,
        shadowOpacity: GLASS_FEATURE_REST.shadowOpacity,
      };
    }
    const clamp = { extrapolate: 'clamp' } as const;
    return {
      glass: scrollY.interpolate({ ...glassParallaxRange(rowY, viewportHeight), ...clamp }),
      ground: scrollY.interpolate({ ...groundParallaxRange(rowY, viewportHeight), ...clamp }),
      shadowScaleX: scrollY.interpolate({ ...shadowScaleRange(rowY, viewportHeight), ...clamp }),
      shadowOpacity: scrollY.interpolate({ ...shadowOpacityRange(rowY, viewportHeight), ...clamp }),
    };
  }, [scrollY, rowY, viewportHeight, still]);
}

/**
 * One tea on the shelf.
 *
 * The photographic feature rows above cut their half-capsule out of the
 * photograph itself. These renders are cut-outs on transparency: there is no
 * rectangle to round and nothing that may be cropped, so the capsule becomes a
 * shape of its own behind the glass, the glass stands on it at `contain`
 * without ever crossing the screen edge, and the two drift against each other
 * as the row crosses the viewport. Everything else — the copy column, the tag,
 * the spacing, the alternating bleed — is the section's existing grammar,
 * reusing its styles rather than restating its numbers.
 *
 * Layer order is DOM order on purpose: react-native-web gives every View
 * z-index 0 (docs/BUILD-REPORT.md), so positioned siblings stack in the order
 * they are written. Ground, shadow, glass. Nothing here may rely on `zIndex`.
 */
export function GlassFeatureRow({
  item,
  glass,
  tag,
  scrollY,
  viewportHeight,
  flip,
  reducedMotion,
  onPress,
}: {
  item: MenuItem;
  glass: ProductCutoutSource;
  tag: string;
  scrollY: Animated.Value;
  viewportHeight: number;
  flip: boolean;
  reducedMotion: boolean;
  onPress: () => void;
}) {
  const tokens = useBrandTokens();
  const styles = createHomeStyles(tokens);
  const [rowY, setRowY] = useState<number | null>(null);
  const onLayout = useCallback((event: LayoutChangeEvent) => {
    const { y } = event.nativeEvent.layout;
    setRowY((current) => (current === y ? current : y));
  }, []);
  // An unmeasured row rests too, rather than showing a pose for a position it
  // does not have yet.
  const motion = useGlassMotion(scrollY, rowY, viewportHeight, reducedMotion || rowY === null);
  const from = item.sizes[0]?.priceCents;
  const soldOut = Boolean(item.soldOutToday);

  return (
    <View onLayout={onLayout} style={[styles.feature, styles.glassFeature, flip && styles.featureFlip]}>
      <View accessible={false} style={[styles.glassSlot, flip ? styles.glassSlotRight : styles.glassSlotLeft]}>
        <Animated.View
          style={[
            styles.glassGround,
            flip ? styles.glassGroundRight : styles.glassGroundLeft,
            { transform: [{ translateY: motion.ground }] },
          ]}
        >
          {/*
            A wash, not a chip: fully present at the bleeding edge where the eye
            reads the section's rhythm, and dissolved into the page where it
            would otherwise fight the copy column. brand200 rather than
            brand100, because brand100 against surface is a two-point step and
            the capsule simply did not read.
          */}
          <LinearGradient
            colors={flip ? [tokens.surface, tokens.surface] : [tokens.surface, tokens.surface]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={StyleSheet.absoluteFill}
          />
        </Animated.View>
        <Animated.View
          pointerEvents="none"
          style={[
            styles.glassShadow,
            flip ? styles.glassShadowRight : styles.glassShadowLeft,
            { opacity: motion.shadowOpacity, transform: [{ scaleX: motion.shadowScaleX }] },
          ]}
        />
        <Animated.View
          style={[
            styles.glassLift,
            flip ? styles.glassLiftRight : styles.glassLiftLeft,
            { transform: [{ translateY: motion.glass }] },
          ]}
        >
          {/* alt="" — the title below names the drink; the glass is decorative. */}
          <ProductCutout source={glass} variant="feature" alt="" style={styles.glassImage} />
        </Animated.View>
      </View>
      <View style={styles.featureCopy}>
        <View style={styles.tag}><Text style={styles.tagText}>{soldOut ? "86'd today" : tag}</Text></View>
        <Text style={styles.featureTitle}>{item.name}</Text>
        <Text numberOfLines={2} style={styles.dropBlurb}>{item.description}</Text>
        {from ? <Text style={styles.featureFrom}>From {formatMoney(from)}</Text> : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={soldOut ? `${item.name}, out for today` : `${ACTION_LABEL}: ${item.name}`}
          disabled={soldOut}
          {...disabledState(soldOut)}
          onPress={onPress}
        >
          <Text style={styles.learnMore}>{soldOut ? 'Back tomorrow' : `${ACTION_LABEL}  ›`}</Text>
        </Pressable>
      </View>
    </View>
  );
}
