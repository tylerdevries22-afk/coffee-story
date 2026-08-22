/**
 * The furniture around the ordering flow: the sticky action bar, the floating
 * bag pill, the rewards banner, ribbons, and the skeletons a menu shows while
 * it loads.
 *
 * Per the Fabric note in AGENTS.md, every animation here rides on a wrapper
 * `View` — never on a `Text` inside it.
 */
import { useEffect, type PropsWithChildren, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppIcon } from '@/components/icon';
import { useTabBarClearance } from '@/components/navigation/tab-screen';
import { formatMoney } from '@/features/money';
import { useReducedMotion } from '@/hooks/use-reduced-motion';
import { disabledState } from '@/lib/a11y-state';
import { colors, fonts, radius, shadow, spacing } from '@/theme/tokens';

/**
 * The tallest home indicator iOS reports.
 *
 * A page that covers the tab bar must not also pay for its height. Inside a
 * tab screen `useSafeAreaInsets()` reports the bar-inclusive inset (see
 * `navigation/tab-screen.tsx`), and every screen after the order hub is a
 * `PushFromRight` overlay drawn *over* that bar — so the raw inset would leave
 * a bar-sized gap under the button. Clamping to the indicator keeps the bar
 * out of the sum without hard-coding a bar height anywhere.
 */
const HOME_INDICATOR_MAX = 34;

/** Bottom padding for a full-screen page that covers the tab bar. */
export function useCoveringBottomInset(): number {
  return Math.min(useSafeAreaInsets().bottom, HOME_INDICATOR_MAX);
}

/**
 * Clearance a scroll view needs so its last row clears a sticky bar.
 *
 * `Screen` hard-codes `paddingBottom: 138` for the tab bar; a page with a
 * sticky footer needs its own number, derived rather than guessed.
 */
export const STICKY_BAR_HEIGHT = 76;

export function useStickyBarClearance(extra: number = spacing.lg): number {
  return useCoveringBottomInset() + STICKY_BAR_HEIGHT + extra;
}

/** The bar pinned to the bottom of a step: one primary action, sometimes two. */
export function StickyActionBar({
  children,
  style,
}: PropsWithChildren<{ style?: StyleProp<ViewStyle> }>) {
  const bottom = useCoveringBottomInset();
  return (
    <View style={[styles.stickyBar, { paddingBottom: bottom + spacing.sm }, style]}>
      {children}
    </View>
  );
}

/**
 * The black pill with its price on the right — "Add to Bag ... $4.67".
 *
 * Separate from `ui.tsx`'s `Button` because the trailing value is load-bearing
 * here: it is how the guest sees a customization change the price without
 * leaving the row they are on.
 */
export function ActionButton({
  label,
  value,
  disabled,
  onPress,
  accessibilityHint,
  leading,
}: {
  label: string;
  value?: string;
  disabled?: boolean;
  onPress: () => void;
  accessibilityHint?: string;
  leading?: ReactNode;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={value ? `${label}, ${value}` : label}
      accessibilityHint={accessibilityHint}
      {...disabledState(Boolean(disabled))}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.actionButton,
        pressed && styles.pressed,
        disabled && styles.actionButtonDisabled,
      ]}
    >
      {leading}
      <Text style={[styles.actionLabel, disabled && styles.actionLabelDisabled]}>{label}</Text>
      {value ? <Text style={[styles.actionValue, disabled && styles.actionLabelDisabled]}>{value}</Text> : null}
    </Pressable>
  );
}

/**
 * The floating "View Bag" pill.
 *
 * It sits on the menu, which still shows the real `UITabBar`, so it clears the
 * bar through `useTabBarClearance()` rather than the covering inset above.
 */
export function CartPill({
  count,
  subtotalCents,
  onPress,
}: {
  count: number;
  subtotalCents: number;
  onPress: () => void;
}) {
  const clearance = useTabBarClearance(spacing.sm);
  if (count <= 0) return null;
  const items = count === 1 ? '1 item' : `${count} items`;
  return (
    <View pointerEvents="box-none" style={[styles.cartPillLayer, { bottom: clearance }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`View bag, ${items}, ${formatMoney(subtotalCents)}`}
        onPress={onPress}
        style={({ pressed }) => [styles.cartPill, pressed && styles.pressed]}
      >
        <View style={styles.cartPillIcon}>
          <AppIcon name="bag.fill" size={18} tintColor={colors.white} />
          <CountBadge count={count} />
        </View>
        <Text style={styles.cartPillLabel}>View Bag</Text>
        <Text style={styles.cartPillValue}>{formatMoney(subtotalCents)}</Text>
      </Pressable>
    </View>
  );
}

/** The red count on the bag mark. Capped at 99, unlike the More tab's 9. */
export function CountBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <View style={styles.countBadge}>
      <Text style={styles.countBadgeText}>{count > 99 ? '99+' : count}</Text>
    </View>
  );
}

/** "Earn 96 Beans for this order" — the gold strip above the pay button. */
export function RewardsBanner({ label }: { label: string }) {
  return (
    <View style={styles.rewardsBanner}>
      <View style={styles.rewardsMark}>
        <AppIcon name="star.fill" size={14} tintColor={colors.brand700} />
      </View>
      <Text style={styles.rewardsLabel}>{label}</Text>
    </View>
  );
}

export type RibbonTone = 'gold' | 'success' | 'danger' | 'quiet';

/** The small flag on a menu row — "New", "Popular", "Sold out". */
export function Ribbon({ label, tone = 'gold' }: { label: string; tone?: RibbonTone }) {
  return (
    <View style={[styles.ribbon, RIBBON_TONES[tone].container]}>
      <Text style={[styles.ribbonText, RIBBON_TONES[tone].text]}>{label}</Text>
    </View>
  );
}

const RIBBON_TONES: Record<RibbonTone, { container: ViewStyle; text: { color: string } }> = {
  gold: { container: { backgroundColor: colors.gold50, borderColor: colors.gold300 }, text: { color: colors.warning } },
  success: { container: { backgroundColor: colors.brand50, borderColor: colors.brand200 }, text: { color: colors.success } },
  danger: { container: { backgroundColor: colors.warm, borderColor: colors.ink200 }, text: { color: colors.danger } },
  quiet: { container: { backgroundColor: colors.warm, borderColor: colors.ink200 }, text: { color: colors.ink600 } },
};

/**
 * A pulsing placeholder block.
 *
 * Under reduced motion it is a flat tint rather than a stopped animation, so
 * there is nothing half-faded left on screen.
 */
export function Skeleton({
  width,
  height,
  radius: cornerRadius = radius.sm,
  style,
}: {
  width?: number | `${number}%`;
  height: number;
  radius?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const reducedMotion = useReducedMotion();
  const pulse = useSharedValue(0.5);

  useEffect(() => {
    if (reducedMotion) {
      pulse.value = 0.5;
      return;
    }
    pulse.value = withRepeat(
      withTiming(1, { duration: 780, easing: Easing.inOut(Easing.quad) }),
      -1,
      true,
    );
  }, [pulse, reducedMotion]);

  const shimmer = useAnimatedStyle(() => ({ opacity: pulse.value }));

  return (
    <Animated.View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        styles.skeleton,
        { height, borderRadius: cornerRadius },
        width === undefined ? styles.skeletonFlex : { width },
        shimmer,
        style,
      ]}
    />
  );
}

/** The menu's loading state: a category strip and a handful of item rows. */
export function MenuSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel="Loading the menu"
      style={styles.menuSkeleton}
    >
      <View style={styles.skeletonStrip}>
        {[92, 128, 104, 84].map((width, index) => (
          <Skeleton key={index} width={width} height={14} radius={radius.pill} />
        ))}
      </View>
      <Skeleton width="60%" height={22} />
      {Array.from({ length: rows }, (_, index) => (
        <View key={index} style={styles.skeletonRow}>
          <Skeleton width={72} height={72} radius={radius.md} />
          <View style={styles.skeletonCopy}>
            <Skeleton height={14} />
            <Skeleton width="35%" height={12} />
            <Skeleton width="80%" height={12} />
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  pressed: { opacity: 0.72, transform: [{ scale: 0.99 }] },

  stickyBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.ink200,
    // Above the FAB layer (30) and the header (20); below a pushed page (60).
    zIndex: 40,
    elevation: 40,
  },

  actionButton: {
    minHeight: 56,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.ink900,
  },
  actionButtonDisabled: { backgroundColor: colors.ink200 },
  actionLabel: { flex: 1, textAlign: 'center', color: colors.white, fontFamily: fonts.sansBold, fontSize: 16 },
  actionLabelDisabled: { color: colors.ink500 },
  actionValue: { color: colors.white, fontFamily: fonts.sansBold, fontSize: 16 },

  cartPillLayer: { position: 'absolute', left: spacing.lg, right: spacing.lg, zIndex: 40, elevation: 40 },
  cartPill: {
    minHeight: 56,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.ink900,
    ...shadow.card,
    shadowOpacity: 0.22,
  },
  cartPillIcon: { width: 24, height: 24, alignItems: 'center', justifyContent: 'center' },
  cartPillLabel: { flex: 1, color: colors.white, fontFamily: fonts.sansBold, fontSize: 16 },
  cartPillValue: { color: colors.white, fontFamily: fonts.sansBold, fontSize: 16 },

  countBadge: {
    position: 'absolute',
    top: -7,
    right: -10,
    minWidth: 20,
    height: 20,
    paddingHorizontal: 5,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: colors.ink900,
    backgroundColor: colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
  },
  countBadgeText: { color: colors.white, fontFamily: fonts.sansBold, fontSize: 11 },

  rewardsBanner: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.gold300,
    backgroundColor: colors.gold50,
  },
  rewardsMark: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.white,
  },
  rewardsLabel: { flex: 1, color: colors.ink900, fontFamily: fonts.sansMedium, fontSize: 14, lineHeight: 20 },

  ribbon: {
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  ribbonText: { fontFamily: fonts.sansBold, fontSize: 11, letterSpacing: 0.3 },

  skeleton: { backgroundColor: colors.ink200 },
  skeletonFlex: { alignSelf: 'stretch' },
  menuSkeleton: { gap: spacing.md },
  skeletonStrip: { flexDirection: 'row', gap: spacing.lg, paddingVertical: spacing.sm },
  skeletonRow: { flexDirection: 'row', gap: spacing.md, alignItems: 'center' },
  skeletonCopy: { flex: 1, gap: spacing.xs },
});
