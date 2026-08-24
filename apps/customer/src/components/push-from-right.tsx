import { useCallback, useEffect, useMemo, useState, type PropsWithChildren } from 'react';
import { StyleSheet, useWindowDimensions } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { useReducedMotion } from '@/hooks/use-reduced-motion';
import { useTokens as useBrandTokens, type BrandTokens } from '@platform/ui';

/** Past a quarter of the screen the push is considered committed to leaving. */
const DISMISS_FRACTION = 0.25;
/** A flick this fast leaves regardless of how far the finger actually travelled. */
const DISMISS_VELOCITY = 800;
const SETTLE_SPRING = { damping: 22, stiffness: 220 } as const;

/**
 * The iOS/Instagram push transition, as a plain overlay driven by a prop.
 *
 * There is no navigator here on purpose: the page is a sibling of the tab
 * shell that covers it, so the tab bar keeps its state while the pushed page
 * is on screen and comes back untouched when it leaves.
 *
 * The tree unmounts once the exit finishes, so a page behind `visible={false}`
 * costs nothing and re-enters fresh rather than resuming a half-scrolled body.
 *
 * Motion rides on this wrapper's `View` only -- never on a `Text` inside it,
 * per the Fabric note in AGENTS.md about shared-value-driven text rendering
 * blank.
 */
export function PushFromRight({
  visible,
  onDismiss,
  children,
}: PropsWithChildren<{ visible: boolean; onDismiss: () => void }>) {
  const tokens = useBrandTokens();
  const styles = createStyles(tokens);
  const reducedMotion = useReducedMotion();
  const { width } = useWindowDimensions();
  // Set true by the exit animation's completion callback, and re-armed on the
  // way in. Without that re-arm `closed` stayed true from the previous close
  // (or from the initial `visible={false}` mount), so `!visible && closed`
  // matched on the very frame the page was dismissed and unmounted the tree
  // before the exit had a single frame to play -- the page vanished instead of
  // sliding out. Re-arming during render is the sanctioned
  // adjust-state-from-props pattern.
  const [closed, setClosed] = useState(!visible);
  const wasClosed = closed;
  if (visible && closed) setClosed(false);
  const translateX = useSharedValue(visible ? 0 : width);

  const markClosed = useCallback(() => setClosed(true), []);

  useEffect(() => {
    // Reduced motion runs the same code path at zero duration: it lands
    // instantly, and the completion callback still fires, so there is exactly
    // one place that decides when the tree may go away.
    if (visible) {
      // Re-arm from offscreen so a second open replays the entrance instead of
      // starting from wherever the last swipe left the value.
      if (wasClosed) translateX.value = width;
      translateX.value = withTiming(0, {
        duration: reducedMotion ? 0 : tokens.motion.slow,
        easing: Easing.out(Easing.cubic),
      });
      return;
    }
    translateX.value = withTiming(
      width,
      { duration: reducedMotion ? 0 : tokens.motion.base, easing: Easing.in(Easing.cubic) },
      (finished) => {
        if (finished) runOnJS(markClosed)();
      },
    );
  }, [visible, reducedMotion, wasClosed, width, translateX, markClosed, tokens.motion.base, tokens.motion.slow]);

  const gesture = useMemo(
    () =>
      Gesture.Pan()
        // Rightward only, and only after a deliberate 12pt drag, so a vertical
        // scroll inside the page still wins the gesture.
        .enabled(!reducedMotion)
        .activeOffsetX([-12, 12])
        .cancelsTouchesInView(false)
        .onUpdate((event) => {
          // Clamped at 0: the page can be dragged away, never dragged further on.
          translateX.value = Math.max(0, event.translationX);
        })
        .onEnd((event) => {
          const committed =
            event.translationX > width * DISMISS_FRACTION || event.velocityX > DISMISS_VELOCITY;
          if (committed) {
            translateX.value = withTiming(
              width,
              { duration: tokens.motion.base, easing: Easing.out(Easing.cubic) },
              (finished) => {
                if (finished) runOnJS(onDismiss)();
              },
            );
            return;
          }
          translateX.value = withSpring(0, SETTLE_SPRING);
        }),
    [reducedMotion, width, translateX, onDismiss, tokens.motion.base],
  );

  const slide = useAnimatedStyle(() => ({ transform: [{ translateX: translateX.value }] }));

  if (!visible && closed) return null;

  return (
    <Animated.View
      accessibilityViewIsModal
      // Inert while it leaves. The tree is deliberately held through the exit
      // so the dismissal has frames to play in, which also left the page
      // accepting taps for the whole 220ms -- long enough to press an action
      // twice on a page that had already committed it.
      pointerEvents={visible ? 'auto' : 'none'}
      style={[StyleSheet.absoluteFill, styles.overlay, slide]}
    >
      {children}
      <GestureDetector gesture={gesture}>
        <Animated.View accessibilityElementsHidden style={styles.swipeZone} />
      </GestureDetector>
    </Animated.View>
  );
}

const createStyles = (tokens: BrandTokens) => StyleSheet.create({
  overlay: {
    position: 'absolute',
    backgroundColor: tokens.surface,
    // Above the bottom tab bar and the floating action button that sit in the
    // same absolutely-positioned layer as this overlay.
    zIndex: 60,
    elevation: 60,
  },
  swipeZone: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 24 },
});
