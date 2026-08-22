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
import { tabState } from '@/lib/a11y-state';
import { colors, fonts, motion, radius, spacing } from '@/theme/tokens';

export type CategoryTab = { id: string; label: string };

type TabLayout = { x: number; width: number };

/** Kept clear of the strip's left edge when a tab is scrolled into view. */
const SCROLL_LEAD = spacing.lg;

export function CategoryStrip({
  tabs,
  activeId,
  onSelect,
}: {
  tabs: readonly CategoryTab[];
  activeId: string;
  onSelect: (id: string) => void;
}) {
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
    const duration = reducedMotion ? 0 : motion.enterMs;
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
  }, [active, reducedMotion, indicatorX, indicatorWidth]);

  useEffect(() => {
    if (!active) return;
    scrollRef.current?.scrollTo({
      x: Math.max(0, active.x - SCROLL_LEAD),
      animated: !reducedMotion,
    });
  }, [active, reducedMotion]);

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

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.surface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.ink200,
  },
  content: { paddingHorizontal: spacing.lg },
  row: { flexDirection: 'row' },
  tab: { minHeight: 48, justifyContent: 'center', paddingHorizontal: spacing.md },
  pressed: { opacity: 0.72 },
  tabLabel: { color: colors.ink600, fontFamily: fonts.sans, fontSize: 15 },
  tabLabelActive: { color: colors.ink900, fontFamily: fonts.sansBold },
  indicator: {
    position: 'absolute',
    left: spacing.lg,
    bottom: 0,
    height: 3,
    borderRadius: radius.pill,
    backgroundColor: colors.ink900,
  },
});
