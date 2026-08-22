/**
 * The kit's primitives. Every visual constant comes from `useTokens()`;
 * nothing here names a color, family, radius, or duration directly (rule 4).
 */
import { useEffect, useRef, useState, type PropsWithChildren, type ReactNode } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import type { OrderStatus } from '@platform/schema';

import { loyaltyProgress } from './loyalty-logic';
import { STATUS_PRESENTATION, type StatusTone } from './order-status-pill-logic';
import { useTokens } from './theme';
import type { BrandTokens } from './tokens';

function toneColor(tokens: BrandTokens, tone: StatusTone): string {
  switch (tone) {
    case 'accent': return tokens.accent;
    case 'success': return tokens.success;
    case 'warning': return tokens.warning;
    case 'danger': return tokens.danger;
    default: return tokens.textMuted;
  }
}

/** With-opacity variant of a #RRGGBB token, for tints and backdrops. */
export function withAlpha(hex: string, alpha: number): string {
  const clamped = Math.round(Math.min(1, Math.max(0, alpha)) * 255);
  return `${hex}${clamped.toString(16).padStart(2, '0').toUpperCase()}`;
}

export function Button({
  label,
  onPress,
  variant = 'primary',
  disabled,
  trailing,
}: {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger';
  disabled?: boolean;
  trailing?: string;
}) {
  const tokens = useTokens();
  const background =
    variant === 'primary' ? tokens.primary
    : variant === 'danger' ? tokens.danger
    : tokens.surfaceElevated;
  const color = variant === 'secondary' ? tokens.textPrimary : tokens.surfaceElevated;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={trailing ? `${label}, ${trailing}` : label}
      accessibilityState={{ disabled: Boolean(disabled) }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        {
          minHeight: 52,
          borderRadius: tokens.radius.pill,
          paddingHorizontal: tokens.spacing.lg,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: tokens.spacing.sm,
          backgroundColor: disabled ? withAlpha(tokens.textMuted, 0.25) : background,
          borderWidth: variant === 'secondary' ? StyleSheet.hairlineWidth : 0,
          borderColor: withAlpha(tokens.textMuted, 0.4),
          opacity: pressed ? 0.8 : 1,
        },
      ]}
    >
      <Text style={{ flex: trailing ? 1 : 0, textAlign: 'center', color: disabled ? tokens.textMuted : color, fontFamily: tokens.fontBody, fontWeight: '700', fontSize: 16 }}>
        {label}
      </Text>
      {trailing ? (
        <Text style={{ color: disabled ? tokens.textMuted : color, fontFamily: tokens.fontBody, fontWeight: '700', fontSize: 16 }}>{trailing}</Text>
      ) : null}
    </Pressable>
  );
}

export function Card({ children, style }: PropsWithChildren<{ style?: StyleProp<ViewStyle> }>) {
  const tokens = useTokens();
  return (
    <View
      style={[
        {
          backgroundColor: tokens.surfaceElevated,
          borderRadius: tokens.radius.md,
          padding: tokens.spacing.lg,
          shadowColor: tokens.textPrimary,
          shadowOpacity: 0.08,
          shadowRadius: 12,
          shadowOffset: { width: 0, height: 4 },
          elevation: 2,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

export function Badge({ label, tone = 'neutral' }: { label: string; tone?: StatusTone }) {
  const tokens = useTokens();
  const color = toneColor(tokens, tone);
  return (
    <View
      style={{
        alignSelf: 'flex-start',
        paddingHorizontal: tokens.spacing.sm,
        paddingVertical: tokens.spacing.xs / 2 + 1,
        borderRadius: tokens.radius.pill,
        borderWidth: 1,
        borderColor: withAlpha(color, 0.5),
        backgroundColor: withAlpha(color, 0.12),
      }}
    >
      <Text style={{ color, fontFamily: tokens.fontBody, fontWeight: '700', fontSize: 11, letterSpacing: 0.3 }}>{label}</Text>
    </View>
  );
}

export function OrderStatusPill({ status }: { status: OrderStatus }) {
  const { label, tone } = STATUS_PRESENTATION[status];
  return <Badge label={label} tone={tone} />;
}

export function QuantityStepper({
  value,
  min = 0,
  max,
  onChange,
  removeHint,
}: {
  value: number;
  min?: number;
  max: number;
  onChange: (next: number) => void;
  /** Label for the minus button when it would remove the line (value === 1, min 0). */
  removeHint?: string;
}) {
  const tokens = useTokens();
  const canDecrease = value > min;
  const canIncrease = value < max;
  const minusRemoves = value === 1 && min === 0;
  const control = (label: string, enabled: boolean, action: () => void, hint?: string) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
      accessibilityState={{ disabled: !enabled }}
      disabled={!enabled}
      onPress={action}
      style={({ pressed }) => ({
        width: 40,
        height: 40,
        borderRadius: tokens.radius.pill,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: enabled ? withAlpha(tokens.primary, 0.08) : withAlpha(tokens.textMuted, 0.08),
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <Text style={{ color: enabled ? tokens.textPrimary : tokens.textMuted, fontSize: 20, fontFamily: tokens.fontBody }}>
        {label === 'Increase' ? '+' : minusRemoves && label === 'Decrease' ? '×' : '−'}
      </Text>
    </Pressable>
  );
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: tokens.spacing.md }}>
      {control('Decrease', canDecrease, () => onChange(value - 1), minusRemoves ? removeHint : undefined)}
      <Text
        accessibilityLiveRegion="polite"
        style={{ minWidth: 24, textAlign: 'center', fontFamily: tokens.fontBody, fontWeight: '700', fontSize: 17, color: tokens.textPrimary }}
      >
        {value}
      </Text>
      {control('Increase', canIncrease, () => onChange(value + 1))}
    </View>
  );
}

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
      <Text style={{ color: tokens.textMuted, fontFamily: tokens.fontBody, fontSize: 13 }}>
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
      <Text style={{ fontFamily: tokens.fontDisplay, fontSize: 20, color: tokens.textPrimary, textAlign: 'center' }}>{title}</Text>
      {message ? (
        <Text style={{ fontFamily: tokens.fontBody, fontSize: 14, lineHeight: 20, color: tokens.textMuted, textAlign: 'center' }}>{message}</Text>
      ) : null}
      {action}
    </View>
  );
}
