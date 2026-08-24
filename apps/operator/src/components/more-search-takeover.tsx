import { useEffect, useState, type PropsWithChildren, type ReactNode } from 'react';
import {
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useReducedMotion } from '@/hooks/use-reduced-motion';
import { AppIcon } from '@/components/icon';
import { useTokens as useBrandTokens, type BrandTokens } from '@platform/ui';

const ENTER_MS = 260;

/**
 * Full-page search for the More screens.
 *
 * Tapping search does not open a panel under the profile card — the page it
 * sits on slides off to the left while a search page carrying a full-width
 * field pushes in from the right, so the field really does span the screen and
 * the results are the whole view rather than a section competing with the rest
 * of the page.
 *
 * Motion uses the legacy Animated API rather than Reanimated: both layers wrap
 * `Text`, and per the Fabric note in AGENTS.md a `Text` under a shared-value
 * driven wrapper renders blank.
 */
export function MoreSearchTakeover({
  searching,
  onClose,
  query,
  onQueryChange,
  placeholder,
  accessibilityLabel,
  results,
  surfaceColor,
  children,
}: PropsWithChildren<{
  searching: boolean;
  onClose: () => void;
  query: string;
  onQueryChange: (next: string) => void;
  placeholder: string;
  accessibilityLabel: string;
  results: ReactNode;
  /**
   * The page's own background. Passed rather than read from `useSurfaceTone`
   * because the takeover wraps the toned `Screen` rather than sitting inside
   * it, so context would always report the default light surface here.
   */
  surfaceColor: string;
}>) {
  const tokens = useBrandTokens();
  const styles = createStyles(tokens);
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const reducedMotion = useReducedMotion();
  const onPlum = surfaceColor !== tokens.surface;
  const [progress] = useState(() => new Animated.Value(searching ? 1 : 0));
  // Written only from the animation's completion callback, never synchronously
  // in the effect body, which the React Compiler lint rejects.
  const [settledClosed, setSettledClosed] = useState(!searching);

  useEffect(() => {
    if (reducedMotion) {
      progress.setValue(searching ? 1 : 0);
      return undefined;
    }
    const animation = Animated.timing(progress, {
      toValue: searching ? 1 : 0,
      duration: ENTER_MS,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    });
    animation.start(({ finished }) => {
      if (finished) setSettledClosed(!searching);
    });
    return () => animation.stop();
  }, [progress, reducedMotion, searching]);

  // The page underneath travels a third of the width, the way a pushed screen
  // parallaxes on iOS rather than leaving in lockstep with the incoming one.
  const pageStyle = {
    opacity: progress.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }),
    transform: [{
      translateX: progress.interpolate({ inputRange: [0, 1], outputRange: [0, -width / 3] }),
    }],
  };
  const searchStyle = {
    opacity: progress,
    transform: [{
      translateX: progress.interpolate({ inputRange: [0, 1], outputRange: [width, 0] }),
    }],
  };

  const mountSearch = searching || !settledClosed;
  const fieldFill = onPlum ? 'rgba(0,0,0,0.24)' : tokens.surface;
  const fieldBorder = onPlum ? 'rgba(255,255,255,0.34)' : tokens.secondary;

  return (
    // The host carries the page colour so no seam shows between the field strip
    // and the results while the two layers slide.
    <View style={[styles.host, { backgroundColor: surfaceColor }]}>
      <Animated.View style={[styles.layer, pageStyle]} pointerEvents={searching ? 'none' : 'auto'}>
        {children}
      </Animated.View>
      {mountSearch ? (
        <Animated.View
          style={[
            styles.searchLayer,
            { paddingTop: insets.top + tokens.spacing.lg, backgroundColor: surfaceColor },
            searchStyle,
          ]}
          pointerEvents={searching ? 'auto' : 'none'}
        >
          <View style={[styles.field, { backgroundColor: fieldFill, borderColor: fieldBorder }]}>
            <AppIcon name="magnifyingglass" size={17} tintColor={onPlum ? tokens.surfaceElevated : tokens.textMuted} />
            <TextInput
              autoFocus={searching}
              accessibilityLabel={accessibilityLabel}
              value={query}
              onChangeText={onQueryChange}
              placeholder={placeholder}
              placeholderTextColor={onPlum ? 'rgba(255,255,255,0.6)' : tokens.textMuted}
              returnKeyType="search"
              style={[styles.input, { color: onPlum ? tokens.surfaceElevated : tokens.textPrimary }]}
            />
            {query ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Clear search"
                onPress={() => onQueryChange('')}
                hitSlop={8}
              >
                <AppIcon name="xmark.circle.fill" size={17} tintColor={onPlum ? 'rgba(255,255,255,0.7)' : tokens.textMuted} />
              </Pressable>
            ) : null}
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel="Close search" onPress={onClose} hitSlop={8}>
            <Text style={[styles.cancel, { color: onPlum ? tokens.surfaceElevated : tokens.primary }]}>Cancel</Text>
          </Pressable>
        </Animated.View>
      ) : null}
      {mountSearch ? (
        <Animated.View
          style={[styles.resultsLayer, { paddingTop: insets.top + 74 }, searchStyle]}
          pointerEvents={searching ? 'auto' : 'none'}
        >
          {results}
        </Animated.View>
      ) : null}
    </View>
  );
}

const createStyles = (tokens: BrandTokens) => StyleSheet.create({
  host: { flex: 1 },
  layer: { flex: 1 },
  searchLayer: {
    // Hugs the top strip only; a full-bleed layer here would swallow taps
    // meant for the results underneath it.
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: tokens.spacing.md,
    paddingHorizontal: tokens.spacing.xl,
    zIndex: 2,
  },
  resultsLayer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 1,
  },
  field: {
    flex: 1,
    minHeight: 44,
    borderRadius: tokens.radius.pill,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: tokens.spacing.sm,
    paddingHorizontal: tokens.spacing.lg,
  },
  input: { flex: 1, fontFamily: tokens.fontBody, fontSize: 16, paddingVertical: 0 },
  cancel: { fontFamily: tokens.fontBody, fontSize: 15 },
});
