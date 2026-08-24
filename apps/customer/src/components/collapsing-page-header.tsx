import type { ReactNode } from 'react';
import {
  Animated,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type TextStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppIcon } from '@/components/icon';
import { useReducedMotion } from '@/hooks/use-reduced-motion';
import { useTokens as useBrandTokens, type BrandTokens } from '@platform/ui';

/**
 * A tab header that follows the iOS large-title pattern: the title starts
 * large and left-aligned, then settles into a centered compact title as the
 * page begins to scroll. Actions stay pinned to the trailing edge throughout.
 *
 * The header owns the top safe-area inset: it is meant to be the first child
 * of a `Screen` whose `contentContainerStyle` sets `paddingTop: 0`, so the
 * collapsed bar's background runs all the way into the notch and the compact
 * title sits *below* the island instead of sliding under it. Pages that let
 * the header own the inset must not also let `Screen` pad the top, or the
 * inset is applied twice.
 */
export function CollapsingPageHeader({
  title,
  eyebrow,
  onBack,
  backLabel = 'Profile',
  actions,
  scrollY,
  backgroundColor,
  expandedHeight,
  compactHeight = 56,
  foregroundColor,
  accentColor,
  borderColor,
  titleStyle,
  flush = false,
}: {
  /** Omit on headers whose tab name already says where you are. */
  title?: string;
  eyebrow?: string;
  onBack?: () => void;
  backLabel?: string;
  actions?: ReactNode;
  scrollY: Animated.Value;
  backgroundColor?: string;
  expandedHeight?: number;
  compactHeight?: number;
  foregroundColor?: string;
  accentColor?: string;
  borderColor?: string;
  titleStyle?: StyleProp<TextStyle>;
  /** Use when the parent ScrollView is already edge-to-edge instead of padded. */
  flush?: boolean;
}) {
  const tokens = useBrandTokens();
  const styles = createStyles(tokens);
  backgroundColor ??= tokens.surface;
  foregroundColor ??= tokens.textPrimary;
  accentColor ??= tokens.primary;
  borderColor ??= tokens.secondary;
  const insets = useSafeAreaInsets();
  const reducedMotion = useReducedMotion();
  const resolvedExpandedHeight = expandedHeight ?? (eyebrow || onBack ? 132 : 104);
  const expanded = insets.top + resolvedExpandedHeight;
  const compact = insets.top + compactHeight;

  const progress = scrollY.interpolate({
    inputRange: [0, 72],
    outputRange: [0, 1],
    extrapolate: 'clamp',
  });
  const height = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [expanded, compact],
  });
  const largeOpacity = progress.interpolate({
    inputRange: [0, 0.72],
    outputRange: [1, 0],
    extrapolate: 'clamp',
  });
  const compactOpacity = progress.interpolate({
    inputRange: [0.2, 1],
    outputRange: [0, 1],
    extrapolate: 'clamp',
  });

  return (
    <Animated.View style={[styles.container, flush && styles.containerFlush, { height, backgroundColor, borderBottomColor: borderColor, paddingTop: insets.top }]}>
      {onBack ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Back to ${backLabel}`}
          hitSlop={8}
          onPress={onBack}
          style={({ pressed }) => [styles.backButton, { top: insets.top }, pressed && styles.pressed]}
        >
          <AppIcon name="chevron.left" size={18} tintColor={accentColor} weight="semibold" />
          <Text numberOfLines={1} style={[styles.backLabel, { color: accentColor }]}>{backLabel}</Text>
        </Pressable>
      ) : null}
      {title ? (
      <Animated.View
        pointerEvents="none"
        style={[
          styles.largeTitleRow,
          actions ? styles.largeTitleWithActions : null,
          {
            opacity: largeOpacity,
            transform: reducedMotion ? undefined : [{ translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [0, -16] }) }],
          },
        ]}
      >
        {eyebrow ? <Text style={[styles.eyebrow, { color: accentColor }]}>{eyebrow}</Text> : null}
        <Text
          accessibilityRole="header"
          adjustsFontSizeToFit
          minimumFontScale={0.72}
          numberOfLines={2}
          style={[styles.largeTitle, { color: foregroundColor }, titleStyle]}
        >
          {title}
        </Text>
      </Animated.View>
      ) : null}
      {title ? (
      <Animated.View
        pointerEvents="none"
        style={[
          styles.compactTitleRow,
          {
            opacity: compactOpacity,
            transform: reducedMotion ? undefined : [{ translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) }],
          },
        ]}
      >
        <Text accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[styles.compactTitle, { color: foregroundColor }]} numberOfLines={1}>{title}</Text>
      </Animated.View>
      ) : null}
      {actions ? <View style={[styles.actions, { top: insets.top }]}>{actions}</View> : null}
    </Animated.View>
  );
}

const createStyles = (tokens: BrandTokens) => StyleSheet.create({
  container: {
    position: 'relative',
    overflow: 'hidden',
    marginHorizontal: -tokens.spacing.xl,
    borderBottomWidth: 1,
    justifyContent: 'flex-end',
    zIndex: 20,
    elevation: 8,
  },
  containerFlush: { marginHorizontal: 0 },
  largeTitleRow: {
    position: 'absolute',
    left: tokens.spacing.xl,
    right: tokens.spacing.xl,
    bottom: tokens.spacing.lg,
    gap: 2,
  },
  largeTitleWithActions: { paddingRight: 136 },
  largeTitle: {
    fontFamily: tokens.fontDisplay,
    fontSize: 36,
    lineHeight: 42,
    letterSpacing: -1,
  },
  compactTitleRow: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 56,
    paddingHorizontal: 112,
    alignItems: 'center',
    justifyContent: 'center',
  },
  compactTitle: { width: '100%', textAlign: 'center', fontFamily: tokens.fontBody, fontSize: 17 },
  eyebrow: {
    fontFamily: tokens.fontBody,
    fontSize: 11,
    letterSpacing: 1.7,
    lineHeight: 16,
    textTransform: 'uppercase',
  },
  backButton: {
    position: 'absolute',
    left: tokens.spacing.md,
    zIndex: 4,
    minWidth: 44,
    maxWidth: 108,
    height: 56,
    borderRadius: tokens.radius.pill,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingHorizontal: tokens.spacing.md,
  },
  backLabel: { flexShrink: 1, fontFamily: tokens.fontBody, fontSize: 16 },
  actions: {
    position: 'absolute',
    right: tokens.spacing.lg,
    height: 56,
    zIndex: 2,
    flexDirection: 'row',
    alignItems: 'center',
    gap: tokens.spacing.md,
  },
  pressed: { opacity: 0.58 },
});
