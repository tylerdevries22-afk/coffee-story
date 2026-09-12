import { StatusBar } from 'expo-status-bar';
import { useCallback, useRef, useState } from 'react';
import {
  Alert, Animated, Pressable, Text, View, useWindowDimensions,
  type LayoutChangeEvent, type NativeScrollEvent, type NativeSyntheticEvent,
  type ScrollView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ErrorState, Screen } from '@/components/ui';
import type { MenuCategoryId } from '@/data/catalog';
import { TEA_MATCHA_CATEGORY } from '@/features/tea-matcha';
import { openWebPath } from '@/lib/web-navigation';
import { useAppState } from '@/state/app-context';
import { useCustomerCatalog } from '@/state/catalog-context';
import {
  AppIcon, useReducedMotion, useTabBarClearance,
  useTokens as useBrandTokens,
} from '@platform/ui';

import { ACTION_DETAIL, ACTION_LABEL } from './home-content';
import { HomeCatalogSections } from './home-catalog-sections';
import { HomeFeatureSections } from './home-feature-sections';
import { PulseDot } from './home-hero-controls';
import { HomeHero } from './home-hero';
import { createHomeStyles } from './home-screen.styles';

export function HomeScreen() {
  const tokens = useBrandTokens();
  const styles = createHomeStyles(tokens);
  const { startOrder } = useAppState();
  const { items: menuItems, status: catalogStatus, refresh: refreshCatalog } = useCustomerCatalog();
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const tabBarClearance = useTabBarClearance(24);
  const reducedMotion = useReducedMotion();
  const [scrollY] = useState(() => new Animated.Value(0));
  const stickyVisible = useRef(false);
  const scrollRef = useRef<ScrollView>(null);
  const categoryOffsets = useRef(new Map<MenuCategoryId, number>());
  const [showStickyCta, setShowStickyCta] = useState(false);
  const [showAssistant, setShowAssistant] = useState(true);
  const [overHero, setOverHero] = useState(true);
  const [expanded, setExpanded] = useState<ReadonlySet<MenuCategoryId>>(new Set());
  const heroHeight = Math.round(width * 1.05) + insets.top * 2;

  const onScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const offset = event.nativeEvent.contentOffset.y;
    const nextVisible = offset > 96;
    if (nextVisible !== stickyVisible.current) {
      stickyVisible.current = nextVisible;
      setShowStickyCta(nextVisible);
    }
    setOverHero(offset < heroHeight - insets.top - 72);
  }, [heroHeight, insets.top]);
  const stickyProgress = scrollY.interpolate({
    inputRange: [72, 128],
    outputRange: [0, 1],
    extrapolate: 'clamp',
  });
  const onBookNow = useCallback(() => {
    startOrder(menuItems[0]?.id);
  }, [menuItems, startOrder]);
  const onOpenPackages = useCallback(() => {
    void openWebPath('/menu').catch((error: unknown) => {
      Alert.alert('Bundles unavailable', error instanceof Error ? error.message : 'Try again in a moment.');
    });
  }, []);
  const onSeeAllTea = useCallback(() => {
    setExpanded((current) => new Set(current).add(TEA_MATCHA_CATEGORY));
    const y = categoryOffsets.current.get(TEA_MATCHA_CATEGORY);
    if (y !== undefined) scrollRef.current?.scrollTo({ y, animated: !reducedMotion });
  }, [reducedMotion]);
  const onCategoryLayout = useCallback((category: MenuCategoryId, event: LayoutChangeEvent) => {
    categoryOffsets.current.set(category, event.nativeEvent.layout.y);
  }, []);
  const toggleCategory = useCallback((category: MenuCategoryId) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(category)) next.delete(category);
      else next.add(category);
      return next;
    });
  }, []);

  return (
    <View style={styles.shell}>
      <StatusBar style={overHero ? 'light' : 'dark'} />
      <Screen
        style={styles.screen}
        contentContainerStyle={styles.content}
        contentInsetAdjustmentBehavior="never"
        scrollRef={scrollRef}
        scrollY={scrollY}
        onScroll={onScroll}
        scrollEventThrottle={16}
      >
        <HomeHero
          width={width}
          heroHeight={heroHeight}
          insetTop={insets.top}
          onBookNow={onBookNow}
          onOpenPackages={onOpenPackages}
        />
        {catalogStatus === 'unavailable' ? (
          // `items` holds the bundled catalog until the live one loads, and it
          // kept rendering here after the load failed: a menu the shop may not
          // sell today, with nothing on screen to say so and no way to try
          // again short of backgrounding the app. The provider keeps retrying
          // on its own; this makes the failure visible and puts the retry
          // under the guest's thumb.
          <ErrorState
            title="The menu did not load."
            message="Check your connection and try again."
            onRetry={refreshCatalog}
          />
        ) : (
          <>
            <HomeFeatureSections
              scrollY={scrollY}
              viewportHeight={height}
              reducedMotion={reducedMotion}
              onSeeAllTea={onSeeAllTea}
            />
            <HomeCatalogSections
              expanded={expanded}
              onCategoryLayout={onCategoryLayout}
              onToggleCategory={toggleCategory}
              showAssistant={showAssistant}
              onCloseAssistant={() => setShowAssistant(false)}
            />
          </>
        )}
      </Screen>
      <Animated.View
        pointerEvents={showStickyCta ? 'auto' : 'none'}
        style={[
          styles.stickyCtaWrap,
          {
            bottom: tabBarClearance,
            opacity: reducedMotion ? (showStickyCta ? 1 : 0) : stickyProgress,
            transform: [{
              translateY: reducedMotion
                ? 0
                : stickyProgress.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }),
            }],
          },
        ]}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={ACTION_LABEL}
          onPress={onBookNow}
          style={({ pressed }) => [styles.stickyBookNowButton, pressed && styles.pressed]}
        >
          <PulseDot reducedMotion={reducedMotion} />
          <Text style={styles.stickyBookNowText}>{ACTION_LABEL}</Text>
          <Text style={styles.stickyBookNowWait}>{ACTION_DETAIL}</Text>
          <AppIcon name="chevron.right" size={14} tintColor={tokens.surfaceElevated} />
        </Pressable>
      </Animated.View>
    </View>
  );
}
