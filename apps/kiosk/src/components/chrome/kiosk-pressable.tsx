import { Pressable, StyleSheet, Text } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';

import { SPRING, useReducedMotion, useTokens } from '@platform/ui';

/**
 * The kiosk's primary action: an ink pill at kiosk scale.
 *
 * `packages/ui`'s Button is sized for a phone (52pt tall, 16pt type). A
 * standing guest two to three feet away needs the 60pt target and 20pt body
 * docs/FIVE-SURFACES.md specifies, and money rides the action per
 * docs/DESIGN.md -- hence `trailing`.
 *
 * The press spring rides the wrapper View; the label is a plain Text with
 * static style, per the Fabric constraint in AGENTS.md.
 */
export function KioskPressable({
  label,
  trailing,
  onPress,
  disabled = false,
  variant = 'primary',
  compact = false,
}: {
  label: string;
  /** Usually the money, so a choice shows its cost where the hand already is. */
  trailing?: string;
  onPress: () => void;
  disabled?: boolean;
  variant?: 'primary' | 'secondary';
  /** Setup keypads keep the same 60pt target without taking action-button width. */
  compact?: boolean;
}) {
  const tokens = useTokens();
  const reduced = useReducedMotion();
  const press = useSharedValue(1);

  const style = useAnimatedStyle(() => ({ transform: [{ scale: press.value }] }));

  const background = variant === 'primary' ? tokens.primary : tokens.surfaceElevated;
  const ink = variant === 'primary' ? tokens.surfaceElevated : tokens.textPrimary;

  return (
    <Animated.View style={style}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={trailing ? `${label}, ${trailing}` : label}
        accessibilityState={{ disabled }}
        aria-disabled={disabled}
        disabled={disabled}
        onPressIn={() => { if (!reduced && !disabled) press.value = withSpring(0.96, SPRING.press); }}
        onPressOut={() => { if (!reduced) press.value = withSpring(1, SPRING.settle); }}
        onPress={onPress}
        style={[
          styles.pill,
          compact ? styles.compact : null,
          {
            backgroundColor: disabled ? tokens.textMuted : background,
            borderRadius: tokens.radius.pill,
            borderWidth: variant === 'secondary' ? 2 : 0,
            borderColor: tokens.textMuted,
            opacity: disabled ? 0.5 : 1,
          },
        ]}
      >
        <Text style={[styles.label, { color: ink, fontFamily: tokens.fontBody, fontSize: tokens.type.xl }]}>
          {label}
        </Text>
        {trailing ? (
          <Text style={[styles.label, { color: ink, fontFamily: tokens.fontBody, fontSize: tokens.type.xl }]}>
            {trailing}
          </Text>
        ) : null}
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  // 60pt is the kiosk floor; this is the one main action, so it takes more.
  pill: {
    minHeight: 88, minWidth: 320, paddingHorizontal: 44,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 16,
  },
  compact: { minHeight: 64, minWidth: 64, paddingHorizontal: 12 },
  label: { fontWeight: '700' },
});
