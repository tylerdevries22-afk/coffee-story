import { useEffect } from 'react';
import { StyleSheet } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { EASING, duration, useReducedMotion, useTokens } from '@platform/ui';

/**
 * The transition between steps.
 *
 * Owned here rather than left to the `Stack`'s own animation, for two reasons.
 * The stack's transition is a push, and this flow is not a stack of pages -- a
 * step can be skipped entirely by the tenant's config, so "back" is not "the
 * previous screen". And the web export used for `docs/captures` needs the same
 * motion the tablet has, which a native stack animation does not give it.
 *
 * A cross-dissolve with a small scale, signed by direction: coming forward
 * settles inward, going back settles outward, so backing out of a step feels
 * like backing out rather than like arriving somewhere new.
 */
export function StepStage({
  stepKey,
  direction = 'forward',
  children,
}: {
  /** Changing this replays the entrance. The step id is the natural value. */
  stepKey: string;
  direction?: 'forward' | 'back';
  children: React.ReactNode;
}) {
  const tokens = useTokens();
  const reduced = useReducedMotion();
  const progress = useSharedValue(reduced ? 1 : 0);

  useEffect(() => {
    progress.value = 0;
    progress.value = withTiming(1, {
      duration: duration(tokens.motion.base, reduced),
      easing: Easing.bezier(...EASING.enter),
    });
  }, [stepKey, reduced, tokens.motion.base, progress]);

  const style = useAnimatedStyle(() => {
    const offset = direction === 'forward' ? 16 : -16;
    return {
      opacity: progress.value,
      transform: [
        { translateX: (1 - progress.value) * offset },
        { scale: 0.985 + progress.value * 0.015 },
      ],
    };
  });

  return (
    <Animated.View
      testID="kiosk-full-screen-stage"
      style={[styles.stage, style]}
    >
      {children}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  // Explicit width keeps the route stage stable underneath the intentional
  // cart overlay and prevents payment routes collapsing to drawer width.
  stage: { flex: 1, alignSelf: 'stretch', width: '100%' },
});
