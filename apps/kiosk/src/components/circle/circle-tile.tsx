import { memo, useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing, useAnimatedStyle, useSharedValue, withDelay, withSequence, withSpring, withTiming,
} from 'react-native-reanimated';

import { EASING, SPRING, duration, staggerDelay, useReducedMotion, useTokens } from '@platform/ui';
import type { MenuImageVariant } from '@platform/ui';

import { KioskMenuImage } from '@/components/menu-image';
import type { BundledArt, ImageRequest } from '@/imagery/resolve-image';
import * as haptics from '@/lib/haptics';

/**
 * One circular tile: a photograph, a label, and a press that feels like one.
 *
 * Every animated value rides the wrapper `Animated.View`. The label below is a
 * plain `Text` with static style, which is the Fabric constraint in AGENTS.md
 * turned into a layout rule -- a shared value driving text renders blank, and
 * the failure is invisible until it is on a tablet in a shop.
 *
 * Memoised on the props that can actually change, because the fill grid renders
 * twenty of these and a parent re-render must not interrupt a press mid-spring.
 */
export const CircleTile = memo(function CircleTile({
  label,
  caption,
  variant,
  request,
  bundled,
  index = 0,
  disabled = false,
  selected = false,
  onPress,
}: {
  label: string;
  caption?: string;
  variant: MenuImageVariant;
  request: ImageRequest;
  bundled?: BundledArt;
  /** Position in the entrance stagger. */
  index?: number;
  disabled?: boolean;
  selected?: boolean;
  onPress: () => void;
}) {
  const tokens = useTokens();
  const reduced = useReducedMotion();

  // Resting at the finished state under reduced motion, rather than animating
  // from zero over zero milliseconds -- the end state is what must be correct.
  const enter = useSharedValue(reduced ? 1 : 0);
  const press = useSharedValue(1);
  const shake = useSharedValue(0);

  /**
   * The entrance runs from an effect, not from the render body.
   *
   * Kicking a shared value off during render looks like it works for tile zero
   * and silently never starts for the staggered ones -- which is exactly how
   * this first shipped: one visible circle at partial opacity and six
   * invisible ones behind it.
   */
  useEffect(() => {
    if (reduced) {
      enter.value = 1;
      return;
    }
    enter.value = withDelay(
      staggerDelay(index, tokens.motion.stagger),
      withTiming(1, {
        duration: duration(tokens.motion.slow, reduced),
        easing: Easing.bezier(...EASING.enter),
      }),
    );
  }, [index, reduced, tokens.motion.stagger, tokens.motion.slow, enter]);

  const wrapper = useAnimatedStyle(() => ({
    opacity: enter.value,
    transform: [
      { translateY: (1 - enter.value) * 14 },
      { translateX: shake.value },
      { scale: press.value },
    ],
  }));

  function onPressIn() {
    if (disabled) return;
    if (!reduced) press.value = withSpring(0.955, SPRING.press);
  }

  function onPressOut() {
    if (!reduced) press.value = withSpring(1, SPRING.settle);
  }

  function handlePress() {
    if (disabled) {
      // A refused tap has to say so. Under reduced motion the haptic still
      // fires -- feedback is not motion.
      haptics.refused();
      if (!reduced) {
        shake.value = withSequence(
          withTiming(-6, { duration: 60 }),
          withTiming(6, { duration: 60 }),
          withTiming(0, { duration: 60 }),
        );
      }
      return;
    }
    haptics.tapped();
    onPress();
  }

  return (
    <Animated.View style={wrapper}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={caption ? `${label}, ${caption}` : label}
        accessibilityState={{ disabled, selected }}
        aria-disabled={disabled}
        aria-selected={selected}
        onPressIn={onPressIn}
        onPressOut={onPressOut}
        onPress={handlePress}
        style={styles.pressable}
      >
        <View
          style={[
            styles.ring,
            selected && { borderColor: tokens.accent, borderWidth: 6 },
            disabled && styles.disabled,
          ]}
        >
          <KioskMenuImage request={request} variant={variant} bundled={bundled} alt="" />
        </View>
        <Text
          numberOfLines={2}
          style={[styles.label, { color: tokens.textPrimary, fontFamily: tokens.fontBody, fontSize: tokens.type.lg }]}
        >
          {label}
        </Text>
        {caption ? (
          <Text
            numberOfLines={1}
            style={[styles.caption, { color: tokens.textMuted, fontFamily: tokens.fontBody, fontSize: tokens.type.md }]}
          >
            {caption}
          </Text>
        ) : null}
      </Pressable>
    </Animated.View>
  );
});

const styles = StyleSheet.create({
  pressable: { alignItems: 'center' },
  ring: { borderRadius: 9999, borderWidth: 0, borderColor: 'transparent', overflow: 'hidden' },
  disabled: { opacity: 0.4 },
  label: { marginTop: 14, fontWeight: '700', textAlign: 'center', maxWidth: 260 },
  caption: { marginTop: 4, textAlign: 'center', maxWidth: 260 },
});
