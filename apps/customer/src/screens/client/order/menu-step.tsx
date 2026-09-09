/**
 * The menu.
 *
 * The page header sits above its own `ScrollView` rather than inside it, so
 * the category strip can be the scroll's one sticky child while the header
 * still collapses on scroll. The pills between them are the order's context —
 * when it is wanted and where it is going — and stay put, because that is the
 * pair a guest re-checks most while they browse.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Pressable,
  ScrollView,
  Text,
  View,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';

import { CollapsingPageHeader } from '@/components/collapsing-page-header';
import { CategoryStrip } from '@/components/order/category-strip';
import { CartPill } from '@/components/order/order-chrome';
import { useTabBarClearance, useTokens as useBrandTokens } from '@platform/ui';
import type { MenuItem } from '@/data/catalog';
import {
  fulfillmentDetail, fulfillmentLabel, describePickupWindow,
  type OrderFulfillment,
} from '@platform/domain';
import { TENANT } from '@/tenant';
import { useCustomerCatalog } from '@/state/catalog-context';

import { menuSections } from './menu-data';
import { SECTION_ACTIVATION_OFFSET, STRIP_HEIGHT } from './menu-step-config';
import { ContextPill, MenuRow } from './menu-step-rows';
import { createStyles } from './menu-step-styles';

export function MenuStep({
  fulfillment,
  windowValue,
  itemCount,
  subtotalCents,
  highlightItemId,
  onBack,
  onEdit,
  onSelectItem,
  onOpenBag,
}: {
  fulfillment: OrderFulfillment;
  windowValue: string | null;
  itemCount: number;
  subtotalCents: number;
  /**
   * The item the guest tapped on Home before landing here. It marks that one
   * row so it is findable in a sixty-item menu -- it does not mean the item is
   * a house favourite, which is what the ribbon used to claim about whatever
   * had last been tapped.
   */
  highlightItemId?: string | null;
  onBack: () => void;
  onEdit: () => void;
  onSelectItem: (item: MenuItem) => void;
  onOpenBag: () => void;
}) {
  const tokens = useBrandTokens();
  const styles = createStyles(tokens);
  const { categories, items, orderingPaused, status, refresh } = useCustomerCatalog();
  const sections = useMemo(() => menuSections(categories, items), [categories, items]);
  const tabs = useMemo(
    () => sections.map((section) => ({ id: section.id, label: section.title })),
    [sections],
  );
  const [activeId, setActiveId] = useState<string>(() => sections[0]?.id ?? '');
  const [scrollY] = useState(() => new Animated.Value(0));
  const scrollRef = useRef<ScrollView>(null);
  const offsets = useRef<Record<string, number>>({});
  // Set while a tap-driven scroll is in flight, so the strip does not flicker
  // through every section the animation passes over on its way.
  const pending = useRef<string | null>(null);
  const clearance = useTabBarClearance(tokens.spacing.xxl);

  const window = windowValue ? describePickupWindow(windowValue, new Date()) : null;
  const isDelivery = fulfillment.mode === 'delivery';

  useEffect(() => {
    if (!sections.some((section) => section.id === activeId)) {
      setActiveId(sections[0]?.id ?? '');
    }
  }, [activeId, sections]);

  const measureSection = useCallback((id: string, event: LayoutChangeEvent) => {
    offsets.current[id] = event.nativeEvent.layout.y;
  }, []);

  const onScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const y = event.nativeEvent.contentOffset.y;
    scrollY.setValue(y);
    const entries = Object.entries(offsets.current);
    if (entries.length === 0) return;
    const reached = entries
      .filter(([, top]) => top <= y + SECTION_ACTIVATION_OFFSET)
      .sort((left, right) => left[1] - right[1])
      .at(-1);
    const next = reached?.[0] ?? entries.sort((left, right) => left[1] - right[1])[0][0];
    if (pending.current) {
      if (pending.current === next) pending.current = null;
      return;
    }
    setActiveId((current) => (current === next ? current : next));
  }, [scrollY]);

  const jumpTo = useCallback((id: string) => {
    const top = offsets.current[id];
    setActiveId(id);
    if (top === undefined) return;
    pending.current = id;
    scrollRef.current?.scrollTo({ y: Math.max(0, top - STRIP_HEIGHT - tokens.spacing.md), animated: true });
  }, [tokens.spacing.md]);

  return (
    <View style={styles.shell}>
      <CollapsingPageHeader
        title={isDelivery ? 'Delivery' : 'Pickup'}
        eyebrow={`${TENANT.identity.name} menu`}
        onBack={onBack}
        backLabel="Order"
        scrollY={scrollY}
        backgroundColor={tokens.surface}
        borderColor={tokens.surface}
      />

      <View style={styles.pills}>
        <ContextPill
          icon="clock"
          label={window ? `${window.dayLabel} · ${window.timeLabel}` : 'Choose a time'}
          onPress={onEdit}
        />
        <ContextPill
          icon="mappin"
          label={fulfillmentLabel(fulfillment)}
          detail={fulfillmentDetail(fulfillment)}
          onPress={onEdit}
          action="Edit"
        />
      </View>

      {orderingPaused ? (
        <View accessibilityRole="alert" style={styles.pausedBanner}>
          <Text style={styles.pausedText}>Ordering is temporarily paused at this shop.</Text>
        </View>
      ) : null}
      {status === 'unavailable' ? (
        <Pressable accessibilityRole="button" accessibilityLabel="Retry menu" onPress={refresh} style={styles.pausedBanner}>
          <Text style={styles.pausedText}>The live menu is reconnecting. Tap to retry.</Text>
        </Pressable>
      ) : null}

      <ScrollView
          ref={scrollRef}
          stickyHeaderIndices={[0]}
          onScroll={onScroll}
          // A finger on the list means the guest has taken over from a
          // tap-driven scroll. Without this the guard stayed armed whenever
          // they interrupted one, and the strip froze on the tapped tab.
          onScrollBeginDrag={() => {
            pending.current = null;
          }}
          scrollEventThrottle={16}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={[styles.scroll, { paddingBottom: clearance + 56 }]}
        >
          <CategoryStrip tabs={tabs} activeId={activeId} onSelect={jumpTo} />

          {sections.map((section) => (
            <View key={section.id} onLayout={(event) => measureSection(section.id, event)} style={styles.section}>
              <View style={styles.sectionHeader}>
                <Text accessibilityRole="header" style={styles.sectionTitle}>{section.title}</Text>
                <Text style={styles.sectionTagline}>{section.tagline}</Text>
              </View>
              {section.items.map((item) => (
                <MenuRow
                  key={item.id}
                  item={item}
                  orderingPaused={orderingPaused}
                  highlighted={item.id === highlightItemId}
                  onPress={() => onSelectItem(item)}
                />
              ))}
            </View>
          ))}
      </ScrollView>

      <CartPill count={itemCount} subtotalCents={subtotalCents} onPress={onOpenBag} />
    </View>
  );
}
