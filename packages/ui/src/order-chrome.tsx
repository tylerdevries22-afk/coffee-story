import type { PropsWithChildren, ReactNode } from 'react';
import { Platform, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { formatMoney } from '@platform/domain';

import { disabledState } from './a11y-state';
import { useTokens } from './theme';
import { withAlpha } from './components';

const HOME_INDICATOR_MAX = 34;
const WEB_TAB_BAR_HEIGHT = 64;
export const STICKY_BAR_HEIGHT = 76;

export function useCoveringBottomInset(): number {
  return Math.min(useSafeAreaInsets().bottom, HOME_INDICATOR_MAX);
}

export function useStickyBarClearance(extra?: number): number {
  const tokens = useTokens();
  return useCoveringBottomInset() + STICKY_BAR_HEIGHT + (extra ?? tokens.spacing.lg);
}

function useTabBarClearance(gap: number): number {
  const insets = useSafeAreaInsets();
  return Platform.OS === 'web' ? Math.max(insets.bottom, 14) + WEB_TAB_BAR_HEIGHT + gap : insets.bottom + gap;
}

export function StickyActionBar({ children, style }: PropsWithChildren<{ style?: StyleProp<ViewStyle> }>) {
  const tokens = useTokens();
  const bottom = useCoveringBottomInset();
  return <View style={[{
    position: 'absolute', left: 0, right: 0, bottom: 0,
    paddingHorizontal: tokens.spacing.lg, paddingTop: tokens.spacing.sm,
    paddingBottom: bottom + tokens.spacing.sm, gap: tokens.spacing.sm,
    backgroundColor: tokens.surface, borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: tokens.secondary, zIndex: 40, elevation: 40,
  }, style]}>{children}</View>;
}

export function ActionButton({ label, value, disabled, onPress, accessibilityHint, leading }: {
  label: string; value?: string; disabled?: boolean; onPress: () => void;
  accessibilityHint?: string; leading?: ReactNode;
}) {
  const tokens = useTokens();
  return <Pressable accessibilityRole="button" accessibilityLabel={value ? `${label}, ${value}` : label}
    accessibilityHint={accessibilityHint} {...disabledState(Boolean(disabled))} disabled={disabled} onPress={onPress}
    style={({ pressed }) => ({
      minHeight: 56, borderRadius: tokens.radius.pill, paddingHorizontal: tokens.spacing.lg,
      flexDirection: 'row', alignItems: 'center', gap: tokens.spacing.sm,
      backgroundColor: disabled ? tokens.secondary : tokens.textPrimary,
      opacity: pressed ? 0.72 : 1, transform: [{ scale: pressed ? 0.99 : 1 }],
    })}>
    {leading}<Text style={{ flex: 1, textAlign: 'center', color: disabled ? tokens.textMuted : tokens.surfaceElevated, fontFamily: tokens.fontBody, fontWeight: '700', fontSize: tokens.type.md }}>{label}</Text>
    {value ? <Text style={{ color: disabled ? tokens.textMuted : tokens.surfaceElevated, fontFamily: tokens.fontBody, fontWeight: '700', fontSize: tokens.type.md }}>{value}</Text> : null}
  </Pressable>;
}

export function SharedCartPill({ count, subtotalCents, onPress, icon }: { count: number; subtotalCents: number; onPress: () => void; icon?: ReactNode }) {
  const tokens = useTokens();
  const clearance = useTabBarClearance(tokens.spacing.sm);
  if (count <= 0) return null;
  const items = count === 1 ? '1 item' : `${count} items`;
  return <View pointerEvents="box-none" style={{ position: 'absolute', left: tokens.spacing.lg, right: tokens.spacing.lg, bottom: clearance, zIndex: 40, elevation: 40 }}>
    <Pressable accessibilityRole="button" accessibilityLabel={`View bag, ${items}, ${formatMoney(subtotalCents)}`} onPress={onPress}
      style={({ pressed }) => ({ minHeight: 56, borderRadius: tokens.radius.pill, paddingHorizontal: tokens.spacing.lg, flexDirection: 'row', alignItems: 'center', gap: tokens.spacing.md, backgroundColor: tokens.textPrimary, shadowColor: tokens.textPrimary, shadowOpacity: tokens.elevation.raised, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 4, opacity: pressed ? 0.72 : 1 })}>
      <View style={{ width: 24, height: 24, alignItems: 'center', justifyContent: 'center' }}>{icon}<CountBadge count={count} /></View>
      <Text style={{ flex: 1, color: tokens.surfaceElevated, fontFamily: tokens.fontBody, fontWeight: '700', fontSize: tokens.type.md }}>View Bag</Text>
      <Text style={{ color: tokens.surfaceElevated, fontFamily: tokens.fontBody, fontWeight: '700', fontSize: tokens.type.md }}>{formatMoney(subtotalCents)}</Text>
    </Pressable>
  </View>;
}

export function CountBadge({ count }: { count: number }) {
  const tokens = useTokens();
  if (count <= 0) return null;
  return <View style={{ position: 'absolute', top: -7, right: -10, minWidth: 20, height: 20, paddingHorizontal: 5, borderRadius: tokens.radius.pill, borderWidth: 2, borderColor: tokens.textPrimary, backgroundColor: tokens.danger, alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: tokens.surfaceElevated, fontFamily: tokens.fontBody, fontWeight: '700', fontSize: tokens.type.xs }}>{count > 99 ? '99+' : count}</Text></View>;
}

export function SharedRewardsBanner({ label, mark }: { label: string; mark?: ReactNode }) {
  const tokens = useTokens();
  return <View style={{ minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: tokens.spacing.sm, paddingHorizontal: tokens.spacing.md, borderRadius: tokens.radius.md, borderWidth: 1, borderColor: tokens.accent, backgroundColor: withAlpha(tokens.accent, 0.12) }}>
    <View style={{ width: 28, height: 28, borderRadius: tokens.radius.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: tokens.surfaceElevated }}>{mark}</View>
    <Text style={{ flex: 1, color: tokens.textPrimary, fontFamily: tokens.fontBody, fontSize: tokens.type.sm, lineHeight: tokens.type.lg }}>{label}</Text>
  </View>;
}

export type RibbonTone = 'gold' | 'success' | 'danger' | 'quiet';
export function Ribbon({ label, tone = 'gold' }: { label: string; tone?: RibbonTone }) {
  const tokens = useTokens();
  const color = tone === 'success' ? tokens.success : tone === 'danger' ? tokens.danger : tone === 'quiet' ? tokens.textMuted : tokens.warning;
  return <View style={{ alignSelf: 'flex-start', paddingHorizontal: tokens.spacing.sm, paddingVertical: 3, borderRadius: tokens.radius.pill, borderWidth: 1, borderColor: withAlpha(color, 0.45), backgroundColor: withAlpha(color, 0.12) }}><Text style={{ color, fontFamily: tokens.fontBody, fontWeight: '700', fontSize: tokens.type.xs, letterSpacing: 0.3 }}>{label}</Text></View>;
}
