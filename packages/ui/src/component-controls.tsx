import type { PropsWithChildren } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import type { OrderStatus } from '@platform/schema';

import { disabledState } from './a11y-state';
import { toneColor, withAlpha } from './component-colors';
import { STATUS_PRESENTATION, type StatusTone } from './order-status-pill-logic';
import { useTokens } from './theme';

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
      {...disabledState(Boolean(disabled))}
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
      <Text style={{ flex: trailing ? 1 : 0, textAlign: 'center', color: disabled ? tokens.textMuted : color, fontFamily: tokens.fontBody, fontWeight: '700', fontSize: tokens.type.md }}>
        {label}
      </Text>
      {trailing ? (
        <Text style={{ color: disabled ? tokens.textMuted : color, fontFamily: tokens.fontBody, fontWeight: '700', fontSize: tokens.type.md }}>{trailing}</Text>
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
          shadowOpacity: tokens.elevation.card,
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
      <Text style={{ color, fontFamily: tokens.fontBody, fontWeight: '700', fontSize: tokens.type.xs, letterSpacing: 0.3 }}>{label}</Text>
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
      {...disabledState(!enabled)}
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
      <Text style={{ color: enabled ? tokens.textPrimary : tokens.textMuted, fontSize: tokens.type.lg, fontFamily: tokens.fontBody }}>
        {label === 'Increase' ? '+' : minusRemoves && label === 'Decrease' ? '×' : '−'}
      </Text>
    </Pressable>
  );
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: tokens.spacing.md }}>
      {control('Decrease', canDecrease, () => onChange(value - 1), minusRemoves ? removeHint : undefined)}
      <Text
        accessibilityLiveRegion="polite"
        style={{ minWidth: 24, textAlign: 'center', fontFamily: tokens.fontBody, fontWeight: '700', fontSize: tokens.type.md, color: tokens.textPrimary }}
      >
        {value}
      </Text>
      {control('Increase', canIncrease, () => onChange(value + 1))}
    </View>
  );
}
