import { useEffect, useRef } from 'react';
import { Animated, Platform, Pressable, Text, View } from 'react-native';

import { AppIcon, useTokens as useBrandTokens } from '@platform/ui';

import { ACTION_DETAIL, ACTION_LABEL } from './home-content';
import { createHomeStyles } from './home-screen.styles';

/** The live "we're open and fast" dot: a soft pulse on a success-green core. */
export function PulseDot({ reducedMotion }: { reducedMotion: boolean }) {
  const tokens = useBrandTokens();
  const styles = createHomeStyles(tokens);
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (reducedMotion) return undefined;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 900, useNativeDriver: Platform.OS !== 'web' }),
        Animated.timing(pulse, { toValue: 0, duration: 900, useNativeDriver: Platform.OS !== 'web' }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse, reducedMotion]);

  const ringScale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 2.1] });
  const ringOpacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.55, 0] });

  return (
    <View style={styles.pulseWrap} accessible={false}>
      <Animated.View style={[styles.pulseRing, { transform: [{ scale: ringScale }], opacity: ringOpacity }]} />
      <View style={styles.pulseCore} />
    </View>
  );
}

export function BookNowPill({ onPress, reducedMotion }: { onPress: () => void; reducedMotion: boolean }) {
  const tokens = useBrandTokens();
  const styles = createHomeStyles(tokens);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${ACTION_LABEL} — ${ACTION_DETAIL}`}
      onPress={onPress}
      style={({ pressed }) => [styles.bookNowPill, pressed && styles.pressed]}
    >
      <PulseDot reducedMotion={reducedMotion} />
      <Text style={styles.bookNowText}>{ACTION_LABEL}</Text>
      <View style={styles.bookNowDivider} />
      <Text style={styles.bookNowWait}>{ACTION_DETAIL}</Text>
      <AppIcon name="chevron.right" size={14} tintColor={tokens.surfaceElevated} />
    </Pressable>
  );
}
