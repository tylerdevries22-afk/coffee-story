import { useEffect } from 'react';
import Svg, { Circle, Path } from 'react-native-svg';
import Animated, {
  Easing, createAnimatedComponent, useAnimatedProps, useSharedValue, withTiming,
} from 'react-native-reanimated';

import { EASING, duration, useReducedMotion, useTokens } from '@platform/ui';

const AnimatedPath = createAnimatedComponent(Path);

const SIZE = 160;
/**
 * The authored tick, and the length of it.
 *
 * `LENGTH` is a constant rather than a measurement because `getTotalLength` is
 * not available on every renderer this ships to. It is pinned by a test, so a
 * path edit that would break the draw fails the suite instead of the kiosk.
 */
export const CHECK_PATH = 'M44 84 L68 108 L118 56';
export const CHECK_LENGTH = 132;

/**
 * The one celebratory moment in the flow.
 *
 * SVG, not text: the Fabric constraint in AGENTS.md means a shared value must
 * never drive a `Text`, and a stroke offset on a `Path` is the way to draw
 * something without one.
 *
 * Under reduced motion the tick is simply already drawn. Success must never
 * require having watched an animation.
 */
export function CheckDraw() {
  const tokens = useTokens();
  const reduced = useReducedMotion();
  const drawn = useSharedValue(reduced ? 1 : 0);

  useEffect(() => {
    drawn.value = reduced
      ? 1
      : withTiming(1, {
        duration: duration(tokens.motion.celebrate, reduced),
        easing: Easing.bezier(...EASING.enter),
      });
  }, [reduced, tokens.motion.celebrate, drawn]);

  const props = useAnimatedProps(() => ({
    strokeDashoffset: CHECK_LENGTH * (1 - drawn.value),
  }));

  return (
    <Animated.View>
      <Svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`}>
        <Circle cx={SIZE / 2} cy={SIZE / 2} r={SIZE / 2 - 6} fill="none" stroke={tokens.success} strokeWidth={4} opacity={0.25} />
        <AnimatedPath
          d={CHECK_PATH}
          fill="none"
          stroke={tokens.success}
          strokeWidth={10}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeDasharray={CHECK_LENGTH}
          animatedProps={props}
        />
      </Svg>
    </Animated.View>
  );
}
