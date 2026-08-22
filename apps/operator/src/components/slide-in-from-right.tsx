import { useEffect, useState, type PropsWithChildren } from 'react';
import { Animated, Easing, StyleSheet, useWindowDimensions } from 'react-native';

import { useReducedMotion } from '@/hooks/use-reduced-motion';

const ENTER_MS = 280;

/**
 * Slides its children in from the right edge on mount, travelling leftward.
 *
 * The tab shells mount and unmount screens per tab, so mounting is the right
 * hook: arriving at More always plays the entrance, whether it was reached by
 * tapping the tab or by swiping. The shells also pass the More index in
 * `selfAnimatingIndexes`, so the pager drops the page in at rest instead of
 * running a second, competing entrance on top of this one.
 *
 * Motion is carried on this wrapper rather than on any text inside it, per the
 * Fabric note in AGENTS.md about shared-value-driven `Text` rendering blank --
 * this uses the legacy Animated API for the same reason the pager does.
 */
export function SlideInFromRight({ children }: PropsWithChildren) {
  const reducedMotion = useReducedMotion();
  const { width } = useWindowDimensions();
  // Starts offscreen on the very first committed frame; setting it inside the
  // effect instead would paint one frame at rest and read as a jump.
  const [translateX] = useState(() => new Animated.Value(reducedMotion ? 0 : width));

  useEffect(() => {
    if (reducedMotion) {
      translateX.setValue(0);
      return;
    }
    const animation = Animated.timing(translateX, {
      toValue: 0,
      duration: ENTER_MS,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [reducedMotion, translateX, width]);

  return (
    <Animated.View style={[styles.fill, { transform: [{ translateX }] }]}>
      {children}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
});
