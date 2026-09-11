import { useEffect, useState } from 'react';
import { Animated, View } from 'react-native';

import { AppIcon, useReducedMotion, useTokens as useBrandTokens } from '@platform/ui';

import { createStyles } from './order-styles';
/**
 * Both illustrations loop a small idle animation. They used to re-implement
 * `useReducedMotion` inline, once each; they now share the hook every other
 * animated surface in the app uses.
 */
function useIdleLoop(durationMs: number, restingValue: number) {
  const reducedMotion = useReducedMotion();
  const [progress] = useState(() => new Animated.Value(0));

  useEffect(() => {
    if (reducedMotion) {
      progress.stopAnimation();
      progress.setValue(restingValue);
      return undefined;
    }
    const animation = Animated.loop(Animated.sequence([
      Animated.timing(progress, { toValue: 1, duration: durationMs, useNativeDriver: true }),
      Animated.timing(progress, { toValue: 0, duration: durationMs, useNativeDriver: true }),
    ]));
    animation.start();
    return () => animation.stop();
  }, [durationMs, progress, reducedMotion, restingValue]);

  return progress;
}

export function DispatchIllustration({ active, compact }: { active: boolean; compact: boolean; }) {
  const tokens = useBrandTokens();
  const styles = createStyles(tokens);
  const progress = useIdleLoop(2400, 0.55);
  const carStyle = {
    opacity: active ? 1 : 0.72,
    transform: [
      { translateX: progress.interpolate({ inputRange: [0, 1], outputRange: [-42, 42] }) },
      { translateY: progress.interpolate({ inputRange: [0, 0.45, 1], outputRange: [2, -4, 2] }) },
    ],
  };
  return (
    <View style={[styles.illustration, compact && styles.illustrationCompact]}>
      <View style={styles.routeLine} />
      <View style={[styles.routePin, styles.routePinStart]} />
      <View style={[styles.routePin, styles.routePinEnd]} />
      <Animated.View style={[styles.car, carStyle]}>
        <AppIcon name="car.side.fill" size={compact ? 46 : 54} tintColor={tokens.primary} />
      </Animated.View>
    </View>
  );
}

export function ShopIllustration({ active, compact }: { active: boolean; compact: boolean; }) {
  const tokens = useBrandTokens();
  const styles = createStyles(tokens);
  const progress = useIdleLoop(2000, 0);
  const steamStyle = {
    opacity: active ? 1 : 0.8,
    transform: [
      { translateY: progress.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0, -7, 0] }) },
      { scale: progress.interpolate({ inputRange: [0, 0.5, 1], outputRange: [1, 1.06, 1] }) },
    ],
  };
  return (
    <View style={[styles.illustration, compact && styles.illustrationCompact]}>
      <Animated.View style={[styles.shopSign, compact && styles.shopSignCompact, active && styles.shopSignActive, steamStyle]}>
        <AppIcon name="bag.fill" size={24} tintColor={tokens.primary} />
      </Animated.View>
      <View style={[styles.shopBuilding, compact && styles.shopBuildingCompact, active && styles.shopBuildingActive]}>
        <View style={styles.shopRoof} />
        <View style={styles.shopWindows}>
          <View style={styles.shopWindow} />
          <View style={styles.shopDoor} />
          <View style={styles.shopWindow} />
        </View>
      </View>
    </View>
  );
}
