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
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';

import { CollapsingPageHeader } from '@/components/collapsing-page-header';
import { AppIcon } from '@/components/icon';
import { MenuImage } from '@/components/menu-image';
import { CategoryStrip } from '@/components/order/category-strip';
import { CartPill, Ribbon } from '@/components/order/order-chrome';
import { disabledState } from '@platform/ui';
import { useTabBarClearance } from '@/components/navigation/tab-screen';
import type { MenuItem } from '@/data/catalog';
import {
  fulfillmentDetail, fulfillmentLabel, describePickupWindow, menuPriceLabel,
  type OrderFulfillment,
} from '@platform/domain';
import { TENANT } from '@/tenant';
import { useCustomerCatalog } from '@/state/catalog-context';

import { menuSections } from './menu-data';
import { useTokens as useBrandTokens, type BrandTokens } from '@platform/ui';

/** How far below the strip a section has to reach before it counts as current. */
const SECTION_ACTIVATION_OFFSET = 140;

/**
 * Height of the pinned category strip: a 48pt row plus its hairline.
 *
 * A tap used to scroll to `top - 8`, which parked the section heading under
 * the strip -- the control the guest had just used to ask for it covered the
 * top half of the answer.
 */
const STRIP_HEIGHT = 49;

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

function ContextPill({
  icon,
  label,
  detail,
  action,
  onPress,
}: {
  icon: 'clock' | 'mappin';
  label: string;
  detail?: string;
  action?: string;
  onPress: () => void;
}) {
  const tokens = useBrandTokens();
  const styles = createStyles(tokens);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={detail ? `${label}, ${detail}. Change` : `${label}. Change`}
      onPress={onPress}
      style={({ pressed }) => [styles.pill, pressed && styles.pressed]}
    >
      <AppIcon name={icon} size={16} tintColor={tokens.primary} />
      <Text numberOfLines={1} style={styles.pillLabel}>
        {label}
        {detail ? <Text style={styles.pillDetail}>{`  ${detail}`}</Text> : null}
      </Text>
      <Text style={styles.pillAction}>{action ?? 'Change'}</Text>
    </Pressable>
  );
}

function MenuRow({
  item,
  orderingPaused,
  highlighted,
  onPress,
}: {
  item: MenuItem;
  orderingPaused: boolean;
  highlighted: boolean;
  onPress: () => void;
}) {
  const tokens = useBrandTokens();
  const styles = createStyles(tokens);
  const price = menuPriceLabel(item.sizes);
  const soldOut = Boolean(item.soldOutToday);
  const unavailable = soldOut || orderingPaused;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={soldOut
        ? `${item.name}, sold out today`
        : orderingPaused
          ? `${item.name}, ordering is temporarily paused`
          : `${item.name}, ${price}. ${item.description}`}
      {...disabledState(unavailable)}
      disabled={unavailable}
      onPress={onPress}
      style={({ pressed }) => [styles.row, highlighted && styles.rowHighlighted, pressed && styles.pressed, soldOut && styles.rowSoldOut]}
    >
      <MenuImage source={item.image} variant="row" alt="" />
      <View style={styles.rowCopy}>
        {soldOut ? <Ribbon label="Sold out today" tone="danger" /> : null}
        {highlighted && !soldOut ? <Ribbon label="From your tap" tone="quiet" /> : null}
        <Text style={styles.rowName}>{item.name}</Text>
        <Text style={styles.rowPrice}>{price}</Text>
        <Text numberOfLines={2} style={styles.rowDescription}>{item.description}</Text>
      </View>
      <AppIcon name="chevron.right" size={16} tintColor={tokens.textMuted} />
    </Pressable>
  );
}

const createStyles = (tokens: BrandTokens) => StyleSheet.create({
  shell: { flex: 1, backgroundColor: tokens.surface },
  pressed: { opacity: 0.72 },

  pills: {
    gap: tokens.spacing.sm,
    paddingHorizontal: tokens.spacing.xl,
    paddingBottom: tokens.spacing.md,
    backgroundColor: tokens.surface,
  },
  pausedBanner: {
    paddingHorizontal: tokens.spacing.xl,
    paddingVertical: tokens.spacing.md,
    backgroundColor: tokens.surface,
  },
  pausedText: { color: tokens.danger, fontFamily: tokens.fontBody, fontSize: 14 },
  pill: {
    minHeight: 46,
    flexDirection: 'row',
    alignItems: 'center',
    gap: tokens.spacing.md,
    paddingHorizontal: tokens.spacing.lg,
    borderRadius: tokens.radius.lg,
    backgroundColor: tokens.surfaceElevated,
  },
  pillLabel: { flex: 1, color: tokens.textPrimary, fontFamily: tokens.fontBody, fontSize: 13 },
  pillDetail: { color: tokens.textMuted, fontFamily: tokens.fontBody, fontSize: 12 },
  pillAction: { color: tokens.primary, fontFamily: tokens.fontBody, fontSize: 13 },

  scroll: { paddingBottom: tokens.spacing.xxl },

  section: { paddingTop: tokens.spacing.xl },
  sectionHeader: { paddingHorizontal: tokens.spacing.xl, paddingBottom: tokens.spacing.md, gap: 2 },
  sectionTitle: { color: tokens.textPrimary, fontFamily: tokens.fontBody, fontSize: 22, lineHeight: 28 },
  sectionTagline: { color: tokens.textMuted, fontFamily: tokens.fontBody, fontSize: 13 },

  rowSoldOut: { opacity: 0.55 },
  row: {
    minHeight: 96,
    flexDirection: 'row',
    alignItems: 'center',
    gap: tokens.spacing.lg,
    paddingHorizontal: tokens.spacing.xl,
    paddingVertical: tokens.spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: tokens.secondary,
  },
  rowHighlighted: { backgroundColor: tokens.surface },
  rowCopy: { flex: 1, gap: 2 },
  rowName: { color: tokens.textPrimary, fontFamily: tokens.fontBody, fontSize: 16 },
  rowPrice: { color: tokens.textMuted, fontFamily: tokens.fontBody, fontSize: 13 },
  rowDescription: { color: tokens.textMuted, fontFamily: tokens.fontBody, fontSize: 13, lineHeight: 18 },
});
