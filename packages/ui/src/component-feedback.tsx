import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { withAlpha } from './component-colors';
import { loyaltyProgress } from './loyalty-logic';
import { useTokens } from './theme';

export function LoyaltyMeter({
  balance,
  rewardEvery,
  pointsName,
}: {
  balance: number;
  rewardEvery: number;
  pointsName: string;
}) {
  const tokens = useTokens();
  const progress = loyaltyProgress(balance, rewardEvery);
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel={`${progress.pointsIntoTier} of ${rewardEvery} ${pointsName} toward your next reward`}
      accessibilityValue={{ min: 0, max: rewardEvery, now: progress.pointsIntoTier }}
      style={{ gap: tokens.spacing.sm }}
    >
      <View style={{ height: 10, borderRadius: tokens.radius.pill, backgroundColor: withAlpha(tokens.accent, 0.18), overflow: 'hidden' }}>
        <View style={{ width: `${Math.round(progress.fraction * 100)}%`, height: '100%', backgroundColor: tokens.accent }} />
      </View>
      <Text style={{ color: tokens.textMuted, fontFamily: tokens.fontBody, fontSize: tokens.type.xs }}>
        {progress.pointsToNext} {pointsName} to your next reward
      </Text>
    </View>
  );
}

/**
 * A pulsing placeholder. Under reduced motion it is a flat tint rather than a
 * stopped animation, so nothing sits half-faded on screen.
 */
export function Skeleton({
  width,
  height,
  radius,
  style,
}: {
  width?: number | `${number}%`;
  height: number;
  radius?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const tokens = useTokens();
  const pulse = useRef(new Animated.Value(0.5)).current;
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    let alive = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (alive) setReducedMotion(enabled);
    });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (reducedMotion) {
      pulse.setValue(0.5);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 780, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.5, duration: 780, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse, reducedMotion]);

  return (
    <Animated.View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        {
          height,
          borderRadius: radius ?? tokens.radius.sm,
          backgroundColor: withAlpha(tokens.textMuted, 0.18),
          opacity: pulse,
        },
        width === undefined ? { alignSelf: 'stretch' } : { width },
        style,
      ]}
    />
  );
}

export function EmptyState({
  title,
  message,
  action,
}: {
  title: string;
  message?: string;
  action?: ReactNode;
}) {
  const tokens = useTokens();
  return (
    <View style={{ alignItems: 'center', gap: tokens.spacing.sm, paddingVertical: tokens.spacing.xxl, paddingHorizontal: tokens.spacing.xl }}>
      <Text style={{ fontFamily: tokens.fontDisplay, fontSize: tokens.type.lg, color: tokens.textPrimary, textAlign: 'center' }}>{title}</Text>
      {message ? (
        <Text style={{ fontFamily: tokens.fontBody, fontSize: tokens.type.sm, lineHeight: tokens.type.lg, color: tokens.textMuted, textAlign: 'center' }}>{message}</Text>
      ) : null}
      {action}
    </View>
  );
}
