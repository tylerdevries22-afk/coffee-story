/**
 * The menu's horizontally scrolling category tabs, with an underline that
 * slides and resizes to the active tab.
 *
 * Nothing in the app measured a control to drive an indicator before this:
 * `ui.tsx`'s `Segmented` and the rewards header both draw a fixed-width bar
 * under an equal-width tab. A menu has seven categories of very different
 * name lengths, so the indicator has to follow real geometry.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { useReducedMotion } from '@/hooks/use-reduced-motion';
import { tabState, useTokens as useBrandTokens, type BrandTokens } from '@platform/ui';

export type CategoryTab = { id: string; label: string };

type TabLayout = { x: number; width: number };

export function CategoryStrip({
  tabs,
  activeId,
  onSelect,
}: {
  tabs: readonly CategoryTab[];
  activeId: string;
  onSelect: (id: string) => void;
}) {
  const tokens = useBrandTokens();
  const styles = createStyles(tokens);
  const reducedMotion = useReducedMotion();
  const scrollRef = useRef<ScrollView>(null);
  const [layouts, setLayouts] = useState<Record<string, TabLayout>>({});
  const indicatorX = useSharedValue(0);
  const indicatorWidth = useSharedValue(0);

  const measure = useCallback((id: string, event: LayoutChangeEvent) => {
    const { x, width } = event.nativeEvent.layout;
    setLayouts((current) => {
      const previous = current[id];
      if (previous && previous.x === x && previous.width === width) return current;
      return { ...current, [id]: { x, width } };
    });
  }, []);

  const active = layouts[activeId];

  useEffect(() => {
    if (!active) return;
    const duration = reducedMotion ? 0 : tokens.motion.slow;
    const easing = Easing.out(Easing.cubic);
    // The very first measurement lands the indicator rather than animating it
    // in from the left edge.
    if (indicatorWidth.value === 0) {
      indicatorX.value = active.x;
      indicatorWidth.value = active.width;
      return;
    }
    indicatorX.value = withTiming(active.x, { duration, easing });
    indicatorWidth.value = withTiming(active.width, { duration, easing });
  }, [active, reducedMotion, indicatorX, indicatorWidth, tokens.motion.slow]);

  useEffect(() => {
    if (!active) return;
    scrollRef.current?.scrollTo({
      x: Math.max(0, active.x - tokens.spacing.xl),
      animated: !reducedMotion,
    });
  }, [active, reducedMotion, tokens.spacing.xl]);

  const indicatorStyle = useAnimatedStyle(() => ({
    width: indicatorWidth.value,
    transform: [{ translateX: indicatorX.value }],
  }));

  return (
    <View style={styles.container}>
      <ScrollView
        ref={scrollRef}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.content}
      >
        <View accessibilityRole="tablist" style={styles.row}>
          {tabs.map((tab) => {
            const selected = tab.id === activeId;
            return (
              <Pressable
                key={tab.id}
                accessibilityRole="tab"
                {...tabState(selected)}
                onLayout={(event) => measure(tab.id, event)}
                onPress={() => onSelect(tab.id)}
                style={({ pressed }) => [styles.tab, pressed && styles.pressed]}
              >
                <Text style={[styles.tabLabel, selected && styles.tabLabelActive]}>{tab.label}</Text>
              </Pressable>
            );
          })}
        </View>
        <Animated.View style={[styles.indicator, indicatorStyle]} />
      </ScrollView>
    </View>
  );
}

const createStyles = (tokens: BrandTokens) => StyleSheet.create({
  container: {
    backgroundColor: tokens.surface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: tokens.secondary,
  },
  content: { paddingHorizontal: tokens.spacing.xl },
  row: { flexDirection: 'row' },
  tab: { minHeight: 48, justifyContent: 'center', paddingHorizontal: tokens.spacing.lg },
  pressed: { opacity: 0.72 },
  tabLabel: { color: tokens.textMuted, fontFamily: tokens.fontBody, fontSize: 15 },
  tabLabelActive: { color: tokens.textPrimary, fontFamily: tokens.fontBody },
  indicator: {
    position: 'absolute',
    left: tokens.spacing.xl,
    bottom: 0,
    height: 3,
    borderRadius: tokens.radius.pill,
    backgroundColor: tokens.textPrimary,
  },
});
