import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ScrollView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';


import { AppIcon } from '@/components/icon';
import { useTabBarClearance } from '@/components/navigation/tab-screen';
import { Screen } from '@/components/ui';
import { DEMO_ADD_ONS, MENU_CATEGORY_META, MENU_ITEMS, type MenuCategoryId, type MenuItem } from '@/data/catalog';
import { useAppState } from '@/state/app-context';
import { useAuth } from '@/state/auth-context';
import { openWebPath } from '@/lib/web-navigation';
import { colors, fonts, radius, spacing } from '@/theme/tokens';
import { demoDrops } from '@/data/drops';
import { dropStatus, dropWindowLabel, weeklyDrops, type Drop } from '@/features/drops';
import { cutoutFeatureLineup, formatMoney, resolveProductMedia } from '@platform/domain';
import { MenuImage } from '@/components/menu-image';
import { SiriAssistant, type SiriCommand } from '@/components/siri/siri-assistant';
import { useReducedMotion } from '@/hooks/use-reduced-motion';
import { TENANT, tenantFeature } from '@/tenant';
import { DropCountdown } from '@platform/ui';
import { ProductCutout, productCutoutSource, type ProductCutoutSource } from '@/components/product-cutout';
import { TENANT_PRODUCT_MEDIA } from '@/tenant/product-media';
import {
  TEA_MATCHA_CATEGORY,
  TEA_MATCHA_SHELF_SIZE,
  teaMatchaCount,
  teaMatchaSeeAllLabel,
  teaMatchaShelf,
  teaMatchaTag,
} from '@/features/tea-matcha';
import {
  GLASS_FEATURE_REST,
  GLASS_BOX_HEIGHT,
  GLASS_BOX_WIDTH,
  GLASS_INSET_X,
  GLASS_TOP,
  GROUND_HEIGHT,
  GROUND_TOP,
  SHADOW_BOTTOM,
  SHADOW_HEIGHT,
  SHADOW_INSET_X,
  SHADOW_WIDTH,
  SLOT_HEIGHT,
  SLOT_WIDTH,
  BLEED,
  glassParallaxRange,
  groundParallaxRange,
  shadowOpacityRange,
  shadowScaleRange,
} from '@/features/glass-feature';
import { disabledState } from '@/lib/a11y-state';

import heroVideo from '../../../assets/hero/home-hero.mp4';
import packagesMedia from '../../../assets/hero/stones.webp';
import giftingMedia from '../../../assets/gift/quiet-hour.webp';

const HOME_PACKAGES = [
  { name: 'The Daily Ritual', detail: '10 × brewed coffee, any size', price: '$35' },
  { name: 'Latte Lover', detail: '5 × signature lattes', price: '$30' },
  { name: 'Boba Week', detail: '5 × boba milk teas', price: '$30' },
  { name: 'The Sweet Pair', detail: '6 × mochi donuts + 2 lattes', price: '$32' },
] as const;

const HERO_SLIDES = ['opening', 'packages', 'gifting'] as const;

/** Tiramisu Latte leads, per the house. */
const HOUSE_FAVORITE_IDS = ['tiramisu-latte', 'spanish-latte'] as const;

/** Rows shown per category before its Show All button. */
const CATEGORY_PREVIEW_COUNT = 7;

/**
 * Client home in the rotating-drop model: a full-bleed hero with the CTA
 * sitting on the media, then dated section headers introducing alternating
 * feature rows whose imagery bleeds off the screen edge — followed by the full
 * menu, sectioned by category with a capped preview and a Show All reveal.
 */
export function HomeScreen() {
  const { openMore, setClientTab, startOrder } = useAppState();
  const { portal } = useAuth();
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const tabBarClearance = useTabBarClearance(24);
  const reducedMotion = useReducedMotion();
  const [scrollY] = useState(() => new Animated.Value(0));
  const [carouselX] = useState(() => new Animated.Value(0));
  const [activeSlide, setActiveSlide] = useState(0);
  const stickyVisible = useRef(false);
  const scrollRef = useRef<ScrollView>(null);
  /** Category tops in content space, measured on layout, for the see-all jump. */
  const categoryOffsets = useRef(new Map<MenuCategoryId, number>());
  const [showStickyCta, setShowStickyCta] = useState(false);
  const [showAssistant, setShowAssistant] = useState(true);
  const [overHero, setOverHero] = useState(true);
  const [expanded, setExpanded] = useState<ReadonlySet<MenuCategoryId>>(new Set());
  const firstName = portal.profile.fullName.split(/\s+/)[0] || 'there';
  const heroHeight = Math.round(width * 1.05) + insets.top * 2;

  const player = useVideoPlayer(heroVideo, (instance) => {
    instance.loop = true;
    instance.muted = true;
    instance.play();
  });

  const favorites = HOUSE_FAVORITE_IDS.map((id) => MENU_ITEMS.find((item) => item.id === id)).filter(
    (item): item is MenuItem => Boolean(item),
  );

  // The rotating-drop model's front door: this week's board — everything live
  // plus what's about to land, each row mapped onto its catalog item.
  const weekly = useMemo(() => {
    if (!tenantFeature('drops')) return [];
    return weeklyDrops(demoDrops(), new Date())
      .map((entry) => ({ drop: entry, item: MENU_ITEMS.find((item) => item.id === entry.itemId) ?? null }))
      .filter((entry): entry is { drop: Drop; item: MenuItem } => entry.item !== null);
  }, []);

  /**
   * The Tea & Matcha shelf: the curated six, narrowed to the ones this build
   * actually ships a glass render for.
   *
   * Two filters rather than one, on purpose. `teaMatchaShelf` is curation --
   * which six drinks, in what order. `cutoutFeatureLineup` is capability --
   * which of them have media. A tenant part-way through shooting its menu gets
   * a shorter shelf; it does not get an empty frame, and it does not fail to
   * boot the way a missing menu photograph would.
   */
  const teaShelf = useMemo(() => {
    const curated = teaMatchaShelf(MENU_ITEMS);
    const { shown } = cutoutFeatureLineup(
      curated.map((item) => item.id),
      TENANT_PRODUCT_MEDIA,
      TEA_MATCHA_SHELF_SIZE,
    );
    return shown
      .map((id) => {
        const item = curated.find((entry) => entry.id === id);
        const ref = resolveProductMedia(id, TENANT_PRODUCT_MEDIA);
        const glass = ref ? productCutoutSource(ref) : null;
        return item && glass ? { ...item, glass } : null;
      })
      .filter((entry): entry is MenuItem & { glass: ProductCutoutSource } => entry !== null);
  }, []);
  const teaCount = useMemo(() => teaMatchaCount(MENU_ITEMS), []);
  const teaMeta = MENU_CATEGORY_META.find((category) => category.id === TEA_MATCHA_CATEGORY) ?? {
    id: TEA_MATCHA_CATEGORY,
    title: 'Tea & Matcha',
    tagline: '',
  };

  const onScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const offset = event.nativeEvent.contentOffset.y;
    // `scrollY` is written natively by `Screen` now. Writing it from JS as well
    // would fight the native driver; this listener keeps only the two pieces of
    // React state that cannot live off the JS thread.
    const nextVisible = offset > 96;
    if (nextVisible !== stickyVisible.current) {
      stickyVisible.current = nextVisible;
      setShowStickyCta(nextVisible);
    }
    // The status bar inverts only while the hero runs underneath it.
    setOverHero(offset < heroHeight - insets.top - 72);
  }, [heroHeight, insets.top]);
  const stickyProgress = scrollY.interpolate({
    inputRange: [72, 128],
    outputRange: [0, 1],
    extrapolate: 'clamp',
  });

  const onBookNow = useCallback(() => {
    startOrder('tiramisu-latte');
  }, [startOrder]);

  const siriCommands: readonly SiriCommand[] = [
    { key: 'book', phrase: 'Order my usual', onRun: () => startOrder() },
    { key: 'next-order', phrase: 'When is my next pickup?', onRun: () => openMore('orders') },
    { key: 'rewards', phrase: 'Check my rewards balance', onRun: () => setClientTab('rewards') },
    { key: 'gift', phrase: 'Send a gift card', onRun: () => setClientTab('gift') },
  ];

  const onOpenPackages = useCallback(() => {
    void openWebPath('/menu').catch((error: unknown) => {
      Alert.alert('Bundles unavailable', error instanceof Error ? error.message : 'Try again in a moment.');
    });
  }, []);

  /**
   * "See all" expands the Tea & Matcha block in the category list below and
   * scrolls to it, rather than entering the order flow.
   *
   * The order flow cannot be deep-linked to a category today -- `MenuStep` will
   * not render until fulfillment and a pickup window are chosen, so a guest who
   * tapped "see all tea" would land in setup rather than on tea. Staying on the
   * page also delivers exactly the four drinks the shelf held back.
   */
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
      if (next.has(category)) {
        next.delete(category);
      } else {
        next.add(category);
      }
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
      <View style={[styles.hero, { height: heroHeight, marginTop: -insets.top }]}>
        <Animated.ScrollView
          horizontal
          pagingEnabled
          bounces={false}
          decelerationRate="fast"
          showsHorizontalScrollIndicator={false}
          scrollEventThrottle={16}
          onScroll={Animated.event(
            [{ nativeEvent: { contentOffset: { x: carouselX } } }],
            { useNativeDriver: true },
          )}
          onMomentumScrollEnd={(event) => {
            setActiveSlide(Math.round(event.nativeEvent.contentOffset.x / width));
          }}
        >
          {HERO_SLIDES.map((slide, index) => {
            const parallax = carouselX.interpolate({
              inputRange: [(index - 1) * width, index * width, (index + 1) * width],
              outputRange: [-width * 0.14, 0, width * 0.14],
              extrapolate: 'clamp',
            });
            return (
              <View key={slide} style={[styles.heroSlide, { width }]}>
                <Animated.View
                  style={[
                    styles.heroMedia,
                    { transform: [{ translateX: reducedMotion ? 0 : parallax }] },
                  ]}
                >
                  {slide === 'opening' ? (
                    <VideoView
                      player={player}
                      style={StyleSheet.absoluteFill}
                      contentFit="cover"
                      nativeControls={false}
                      accessibilityLabel={`Inside the ${TENANT.identity.name} café`}
                    />
                  ) : (
                    <Image
                      source={slide === 'packages' ? packagesMedia : giftingMedia}
                      style={StyleSheet.absoluteFill}
                      contentFit="cover"
                      alt={slide === 'packages' ? 'Coffee beans and bundles ready for pickup' : `A ${TENANT.identity.name} gift card design`}
                    />
                  )}
                </Animated.View>
                <LinearGradient
                  pointerEvents="none"
                  colors={['rgba(36,23,16,0.38)', 'rgba(36,23,16,0.02)', 'rgba(36,23,16,0.56)']}
                  locations={[0, 0.42, 1]}
                  style={StyleSheet.absoluteFill}
                />
                {slide === 'opening' ? (
                  <View style={styles.openingContent}>
                    <BookNowPill onPress={onBookNow} reducedMotion={reducedMotion} />
                  </View>
                ) : null}
                {slide === 'packages' ? (
                  <View style={styles.packagePanel}>
                    <View style={styles.packageHeadingRow}>
                      <View>
                        <Text style={styles.storyEyebrowDark}>Bundles &amp; beans</Text>
                        <Text style={styles.packageTitle}>Stock your story.</Text>
                      </View>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="View bundle details"
                        hitSlop={8}
                        onPress={onOpenPackages}
                        style={({ pressed }) => [styles.packageArrow, pressed && styles.pressed]}
                      >
                        <AppIcon name="chevron.right" size={16} tintColor={colors.brand700} />
                      </Pressable>
                    </View>
                    {HOME_PACKAGES.map((carePackage) => (
                      <View key={carePackage.name} style={styles.packageRow}>
                        <View style={styles.packageCopy}>
                          <Text style={styles.packageName}>{carePackage.name}</Text>
                          <Text numberOfLines={1} style={styles.packageDetail}>{carePackage.detail}</Text>
                        </View>
                        <Text style={styles.packagePrice}>{carePackage.price}</Text>
                      </View>
                    ))}
                  </View>
                ) : null}
                {slide === 'gifting' ? (
                  <View style={styles.storyContent}>
                    <Text style={styles.storyEyebrow}>A blessing in every cup</Text>
                    <Text style={styles.storyTitle}>Gift their next favorite cup.</Text>
                    <Text style={styles.storyBody}>Digital gift cards arrive beautifully and never expire.</Text>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Send a ${TENANT.identity.name} gift card`}
                      onPress={() => setClientTab('gift')}
                      style={({ pressed }) => [styles.storyButton, pressed && styles.pressed]}
                    >
                      <Text style={styles.storyButtonText}>Send a Gift</Text>
                      <AppIcon name="chevron.right" size={14} tintColor={colors.ink900} />
                    </Pressable>
                  </View>
                ) : null}
              </View>
            );
          })}
        </Animated.ScrollView>
        <View pointerEvents="none" style={styles.dots}>
          {HERO_SLIDES.map((slide, index) => (
            <View key={slide} style={[styles.dot, activeSlide === index && styles.dotActive]} />
          ))}
        </View>
      </View>

      {weekly.length ? (
        <View style={styles.dropSection}>
          {/* The dated drop board: a date-range chip over a generic section
              title, then each drop as an alternating edge-bleed feature row —
              the same header + staggered-row grammar as the rest of the page,
              so a second drop in the window slots in without a new layout. */}
          <SectionHeader
            pill={dropWindowLabel(weekly.map((entry) => entry.drop))}
            title="Weekly Drops"
            body="New and returning pours land each week. Order them before they're gone."
          />
          {weekly.map((entry, index) => (
            <DropFeatureRow
              key={entry.drop.id}
              drop={entry.drop}
              item={entry.item}
              flip={index % 2 === 1}
              onPress={() => startOrder(entry.item.id)}
            />
          ))}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Past drops"
            onPress={() => openMore('drops')}
            style={({ pressed }) => [styles.dropArchiveLink, pressed && { opacity: 0.7 }]}
          >
            <Text style={styles.dropArchiveText}>Past drops</Text>
          </Pressable>
        </View>
      ) : null}

      <SectionHeader
        pill={`Welcome back, ${firstName}`}
        title="House Favorites"
        body={`The drinks ${TENANT.location.address.city || 'our neighborhood'} keeps coming back for — handcrafted by ${TENANT.identity.name}.`}
      />
      {favorites.map((item, index) => (
        <FeatureRow
          key={item.id}
          item={item}
          tag="Most Loved"
          flip={index % 2 === 1}
          onPress={() => startOrder(item.id)}
        />
      ))}

      {teaShelf.length ? (
        <>
          <SectionHeader
            pill={teaMeta.tagline}
            title={teaMeta.title}
            body="Stone-ground matcha, black tea and warm spice, poured tall over ice."
          />
          {teaShelf.map((item, index) => (
            <GlassFeatureRow
              key={item.id}
              item={item}
              glass={item.glass}
              tag={teaMatchaTag(item.id)}
              scrollY={scrollY}
              viewportHeight={height}
              // The favourites above are an even number of rows, so the
              // alternation carries into this section unbroken.
              flip={index % 2 === 1}
              reducedMotion={reducedMotion}
              onPress={() => startOrder(item.id)}
            />
          ))}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Show all ${teaMeta.title}`}
            onPress={onSeeAllTea}
            style={({ pressed }) => [styles.dropArchiveLink, pressed && { opacity: 0.7 }]}
          >
            <Text style={styles.dropArchiveText}>{teaMatchaSeeAllLabel(teaCount)}</Text>
          </Pressable>
        </>
      ) : null}

      <SectionHeader
        pill="The Full Menu"
        title="Explore by Category"
        body="Every drink and bite we serve — tap anything to start an order."
      />
      {MENU_CATEGORY_META.map((category) => {
        const items = MENU_ITEMS.filter((item) => item.category === category.id);
        const isExpanded = expanded.has(category.id);
        const visible = isExpanded ? items : items.slice(0, CATEGORY_PREVIEW_COUNT);
        return (
          <View
            key={category.id}
            onLayout={(event) => onCategoryLayout(category.id, event)}
            style={styles.categorySection}
          >
            <View style={styles.categoryHeader}>
              <View style={styles.categoryHeaderCopy}>
                <Text accessibilityRole="header" style={styles.categoryTitle}>{category.title}</Text>
                <Text style={styles.categoryTagline}>{category.tagline}</Text>
              </View>
              <Text style={styles.categoryCount}>{items.length}</Text>
            </View>
            <View style={styles.menuList}>
              {visible.map((item) => (
                <MenuRow key={item.id} item={item} onPress={() => startOrder(item.id)} />
              ))}
            </View>
            {items.length > CATEGORY_PREVIEW_COUNT ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={isExpanded ? `Show fewer ${category.title}` : `Show all ${category.title}`}
                onPress={() => toggleCategory(category.id)}
                style={({ pressed }) => [styles.showAllButton, pressed && styles.pressed]}
              >
                <Text style={styles.showAllText}>
                  {isExpanded ? 'Show less' : `Show all ${items.length}`}
                </Text>
                <AppIcon name={isExpanded ? 'chevron.up' : 'chevron.down'} size={13} tintColor={colors.brand700} />
              </Pressable>
            ) : null}
          </View>
        );
      })}

      <SectionHeader
        pill="Make It Yours"
        title="Add-Ons"
        body="Small additions that make a cup feel like your own."
      />
      <View style={styles.addOns}>
        {DEMO_ADD_ONS.map((addOn) => (
          <View key={addOn.slug} style={styles.addOnRow}>
            <View style={styles.addOnCopy}>
              <Text style={styles.addOnName}>{addOn.name}</Text>
              <Text style={styles.addOnBody}>{addOn.description}</Text>
            </View>
            <Text style={styles.addOnPrice}>${(addOn.priceCents / 100).toFixed(2).replace(/\.00$/, '')}</Text>
          </View>
        ))}
      </View>

      {showAssistant ? (
        <View style={styles.siriWrap}>
          <SiriAssistant commands={siriCommands} onClose={() => setShowAssistant(false)} />
        </View>
      ) : null}

      {/* Preserve the final breathing room without rendering a second CTA. */}
      <View style={styles.footerCtaSpace} accessible={false} />
      </Screen>
      <Animated.View
        pointerEvents={showStickyCta ? 'auto' : 'none'}
        style={[
          styles.stickyCtaWrap,
          {
            bottom: tabBarClearance,
            opacity: reducedMotion ? (showStickyCta ? 1 : 0) : stickyProgress,
            transform: [{ translateY: reducedMotion ? 0 : stickyProgress.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) }],
          },
        ]}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Book now"
          onPress={onBookNow}
          style={({ pressed }) => [styles.stickyBookNowButton, pressed && styles.pressed]}
        >
          <PulseDot reducedMotion={reducedMotion} />
          <Text style={styles.stickyBookNowText}>Order Now</Text>
          <Text style={styles.stickyBookNowWait}>~ 3 min</Text>
          <AppIcon name="chevron.right" size={14} tintColor={colors.white} />
        </Pressable>
      </Animated.View>
    </View>
  );
}

/** The live "we're open and fast" dot: a soft pulse on a success-green core. */
function PulseDot({ reducedMotion }: { reducedMotion: boolean }) {
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (reducedMotion) return undefined;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 900, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 900, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse, reducedMotion]);

  const ringScale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 2.1] });
  const ringOpacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.55, 0] });

  return (
    <View style={styles.pulseWrap} accessible={false}>
      <Animated.View style={[styles.pulseRing, { transform: [{ scale: ringScale }], opacity: ringOpacity }]} />
      <View style={styles.pulseCore} />
    </View>
  );
}

function BookNowPill({ onPress, reducedMotion }: { onPress: () => void; reducedMotion: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Book now — about a 3 minute wait"
      onPress={onPress}
      style={({ pressed }) => [styles.bookNowPill, pressed && styles.pressed]}
    >
      <PulseDot reducedMotion={reducedMotion} />
      <Text style={styles.bookNowText}>Order Now</Text>
      <View style={styles.bookNowDivider} />
      <Text style={styles.bookNowWait}>~ 3 min</Text>
      <AppIcon name="chevron.right" size={14} tintColor={colors.white} />
    </Pressable>
  );
}

function SectionHeader({ pill, title, body }: { pill: string; title: string; body: string }) {
  return (
    <View style={styles.sectionHeader}>
      <View style={styles.pill}><Text style={styles.pillText}>{pill}</Text></View>
      <Text accessibilityRole="header" style={styles.sectionTitle}>{title}</Text>
      <Text style={styles.sectionBody}>{body}</Text>
    </View>
  );
}

function FeatureRow({
  item,
  tag,
  flip,
  onPress,
}: {
  item: MenuItem;
  tag: string;
  flip: boolean;
  onPress: () => void;
}) {
  const from = item.sizes[0]?.priceCents;
  return (
    <View style={[styles.feature, flip && styles.featureFlip]}>
      <Image
        source={item.image}
        style={[styles.featureImage, flip ? styles.featureImageRight : styles.featureImageLeft]}
        contentFit="cover"
        alt={item.name}
      />
      <View style={styles.featureCopy}>
        <View style={styles.tag}><Text style={styles.tagText}>{tag}</Text></View>
        <Text style={styles.featureTitle}>{item.name}</Text>
        {from ? <Text style={styles.featureFrom}>From {formatMoney(from)}</Text> : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Order ${item.name}`}
          onPress={onPress}
        >
          <Text style={styles.learnMore}>Order Now  ›</Text>
        </Pressable>
      </View>
    </View>
  );
}

/** One drop on the weekly board, in the page's alternating feature grammar. */
function DropFeatureRow({
  drop,
  item,
  flip,
  onPress,
}: {
  drop: Drop;
  item: MenuItem;
  flip: boolean;
  onPress: () => void;
}) {
  const live = dropStatus(drop, new Date()) === 'live';
  return (
    <View style={[styles.feature, flip && styles.featureFlip]}>
      <Image
        source={item.image}
        style={[styles.featureImage, flip ? styles.featureImageRight : styles.featureImageLeft]}
        contentFit="cover"
        alt={drop.title}
      />
      <View style={styles.featureCopy}>
        <View style={styles.tag}><Text style={styles.tagText}>{live ? 'This week only' : 'Coming soon'}</Text></View>
        <Text style={styles.featureTitle}>{drop.title}</Text>
        <Text numberOfLines={2} style={styles.dropBlurb}>{drop.blurb}</Text>
        <DropCountdown startsAt={new Date(drop.startsAt)} endsAt={new Date(drop.endsAt)} />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${drop.title}. Order the drop`}
          onPress={onPress}
        >
          <Text style={styles.learnMore}>{live ? 'Order it while it lasts  ›' : 'See what’s pouring next  ›'}</Text>
        </Pressable>
      </View>
    </View>
  );
}

type GlassMotion = {
  glass: Animated.AnimatedInterpolation<number> | number;
  ground: Animated.AnimatedInterpolation<number> | number;
  shadowScaleX: Animated.AnimatedInterpolation<number> | number;
  shadowOpacity: Animated.AnimatedInterpolation<number> | number;
};

/**
 * Four interpolations off the natively driven scroll position, or the designed
 * still frame.
 *
 * Memoised because each one is a node attached to that value: rebuilding four
 * per row on every parent render would churn native nodes for nothing.
 */
function useGlassMotion(
  scrollY: Animated.Value,
  rowY: number | null,
  viewportHeight: number,
  still: boolean,
): GlassMotion {
  return useMemo<GlassMotion>(() => {
    if (still || rowY === null) {
      return {
        glass: GLASS_FEATURE_REST.glassShift,
        ground: GLASS_FEATURE_REST.groundShift,
        shadowScaleX: GLASS_FEATURE_REST.shadowScaleX,
        shadowOpacity: GLASS_FEATURE_REST.shadowOpacity,
      };
    }
    const clamp = { extrapolate: 'clamp' } as const;
    return {
      glass: scrollY.interpolate({ ...glassParallaxRange(rowY, viewportHeight), ...clamp }),
      ground: scrollY.interpolate({ ...groundParallaxRange(rowY, viewportHeight), ...clamp }),
      shadowScaleX: scrollY.interpolate({ ...shadowScaleRange(rowY, viewportHeight), ...clamp }),
      shadowOpacity: scrollY.interpolate({ ...shadowOpacityRange(rowY, viewportHeight), ...clamp }),
    };
  }, [scrollY, rowY, viewportHeight, still]);
}

/**
 * One tea on the shelf.
 *
 * The photographic feature rows above cut their half-capsule out of the
 * photograph itself. These renders are cut-outs on transparency: there is no
 * rectangle to round and nothing that may be cropped, so the capsule becomes a
 * shape of its own behind the glass, the glass stands on it at `contain`
 * without ever crossing the screen edge, and the two drift against each other
 * as the row crosses the viewport. Everything else — the copy column, the tag,
 * the spacing, the alternating bleed — is the section's existing grammar,
 * reusing its styles rather than restating its numbers.
 *
 * Layer order is DOM order on purpose: react-native-web gives every View
 * z-index 0 (docs/BUILD-REPORT.md), so positioned siblings stack in the order
 * they are written. Ground, shadow, glass. Nothing here may rely on `zIndex`.
 */
function GlassFeatureRow({
  item,
  glass,
  tag,
  scrollY,
  viewportHeight,
  flip,
  reducedMotion,
  onPress,
}: {
  item: MenuItem;
  glass: ProductCutoutSource;
  tag: string;
  scrollY: Animated.Value;
  viewportHeight: number;
  flip: boolean;
  reducedMotion: boolean;
  onPress: () => void;
}) {
  const [rowY, setRowY] = useState<number | null>(null);
  const onLayout = useCallback((event: LayoutChangeEvent) => {
    const { y } = event.nativeEvent.layout;
    setRowY((current) => (current === y ? current : y));
  }, []);
  // An unmeasured row rests too, rather than showing a pose for a position it
  // does not have yet.
  const motion = useGlassMotion(scrollY, rowY, viewportHeight, reducedMotion || rowY === null);
  const from = item.sizes[0]?.priceCents;
  const soldOut = Boolean(item.soldOutToday);

  return (
    <View onLayout={onLayout} style={[styles.feature, styles.glassFeature, flip && styles.featureFlip]}>
      <View accessible={false} style={[styles.glassSlot, flip ? styles.glassSlotRight : styles.glassSlotLeft]}>
        <Animated.View
          style={[
            styles.glassGround,
            flip ? styles.glassGroundRight : styles.glassGroundLeft,
            { transform: [{ translateY: motion.ground }] },
          ]}
        >
          {/*
            A wash, not a chip: fully present at the bleeding edge where the eye
            reads the section's rhythm, and dissolved into the page where it
            would otherwise fight the copy column. brand200 rather than
            brand100, because brand100 against surface is a two-point step and
            the capsule simply did not read.
          */}
          <LinearGradient
            colors={flip ? [colors.brand50, colors.brand200] : [colors.brand200, colors.brand50]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={StyleSheet.absoluteFill}
          />
        </Animated.View>
        <Animated.View
          pointerEvents="none"
          style={[
            styles.glassShadow,
            flip ? styles.glassShadowRight : styles.glassShadowLeft,
            { opacity: motion.shadowOpacity, transform: [{ scaleX: motion.shadowScaleX }] },
          ]}
        />
        <Animated.View
          style={[
            styles.glassLift,
            flip ? styles.glassLiftRight : styles.glassLiftLeft,
            { transform: [{ translateY: motion.glass }] },
          ]}
        >
          {/* alt="" — the title below names the drink; the glass is decorative. */}
          <ProductCutout source={glass} variant="feature" alt="" style={styles.glassImage} />
        </Animated.View>
      </View>
      <View style={styles.featureCopy}>
        <View style={styles.tag}><Text style={styles.tagText}>{soldOut ? "86'd today" : tag}</Text></View>
        <Text style={styles.featureTitle}>{item.name}</Text>
        <Text numberOfLines={2} style={styles.dropBlurb}>{item.description}</Text>
        {from ? <Text style={styles.featureFrom}>From {formatMoney(from)}</Text> : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={soldOut ? `${item.name}, out for today` : `Order ${item.name}`}
          disabled={soldOut}
          {...disabledState(soldOut)}
          onPress={onPress}
        >
          <Text style={styles.learnMore}>{soldOut ? 'Back tomorrow' : 'Order Now  ›'}</Text>
        </Pressable>
      </View>
    </View>
  );
}

function MenuRow({ item, onPress }: { item: MenuItem; onPress: () => void }) {
  const from = item.sizes[0]?.priceCents;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Order ${item.name}`}
      onPress={onPress}
      style={({ pressed }) => [styles.menuRow, pressed && styles.pressed]}
    >
      <MenuImage source={item.image} variant="thumb" alt={item.name} />
      <View style={styles.menuRowCopy}>
        <Text style={styles.menuRowName}>{item.name}</Text>
        <Text numberOfLines={1} style={styles.menuRowBody}>{item.description}</Text>
      </View>
      {from ? <Text style={styles.menuRowPrice}>{formatMoney(from)}</Text> : null}
      <AppIcon name="chevron.right" size={13} tintColor={colors.ink400} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  dropSection: { gap: 0 },
  dropBlurb: { color: colors.ink500, fontFamily: fonts.sans, fontSize: 13, lineHeight: 18 },
  dropArchiveLink: { alignSelf: 'center', marginTop: spacing.md, paddingVertical: spacing.xs, paddingHorizontal: spacing.md },
  dropArchiveText: { color: colors.ink600, fontFamily: fonts.sansMedium, fontSize: 14, textDecorationLine: 'underline' },
  shell: { flex: 1 },
  screen: { backgroundColor: colors.surface },
  content: { paddingTop: 0, paddingHorizontal: 0, paddingBottom: 150, gap: 0 },
  // overflow hidden keeps the video inside the hero box: on web an absolutely
  // filled child otherwise paints behind the whole page.
  hero: { width: '100%', backgroundColor: colors.brand100, overflow: 'hidden' },
  heroSlide: { height: '100%', overflow: 'hidden' },
  heroMedia: { position: 'absolute', top: 0, bottom: 0, left: '-14%', right: '-14%' },
  openingContent: { position: 'absolute', left: spacing.lg, right: spacing.lg, bottom: 42 },

  // Content-width and centered, sized to the carousel's compact pill button
  // (the gifting slide's) rather than spanning the screen edge to edge.
  bookNowPill: {
    alignSelf: 'center',
    minHeight: 46,
    borderRadius: radius.pill,
    backgroundColor: colors.brand600,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  bookNowText: { color: colors.white, fontFamily: fonts.sansBold, fontSize: 15 },
  bookNowDivider: { width: 1, height: 16, backgroundColor: 'rgba(255,255,255,0.35)' },
  bookNowWait: { color: 'rgba(255,255,255,0.82)', fontFamily: fonts.sansMedium, fontSize: 13 },

  pulseWrap: { width: 12, height: 12, alignItems: 'center', justifyContent: 'center' },
  pulseRing: { position: 'absolute', width: 12, height: 12, borderRadius: 8, backgroundColor: colors.liveGlow },
  pulseCore: { width: 7, height: 7, borderRadius: 5, backgroundColor: colors.liveGlow },

  pressed: { opacity: 0.85 },
  dots: { position: 'absolute', left: spacing.lg, bottom: 19, flexDirection: 'row', gap: 6 },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.55)' },
  dotActive: { width: 22, backgroundColor: colors.white },

  packagePanel: {
    position: 'absolute',
    left: spacing.md,
    right: spacing.md,
    bottom: 42,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.78)',
    backgroundColor: 'rgba(255,253,248,0.94)',
    padding: spacing.md,
  },
  packageHeadingRow: { minHeight: 54, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  storyEyebrowDark: { color: colors.brand700, fontFamily: fonts.sansBold, fontSize: 10, letterSpacing: 1.2, textTransform: 'uppercase' },
  packageTitle: { color: colors.ink900, fontFamily: fonts.display, fontSize: 22, lineHeight: 27 },
  packageArrow: { width: 44, height: 44, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.brand50 },
  packageRow: { minHeight: 38, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderTopWidth: 1, borderTopColor: colors.ink200 },
  packageCopy: { flex: 1, minWidth: 0 },
  packageName: { color: colors.ink900, fontFamily: fonts.sansBold, fontSize: 13 },
  packageDetail: { color: colors.ink600, fontFamily: fonts.sans, fontSize: 10, marginTop: 1 },
  packagePrice: { color: colors.ink900, fontFamily: fonts.sansBold, fontSize: 13 },
  storyContent: { position: 'absolute', left: spacing.lg, right: spacing.lg, bottom: 52, gap: spacing.sm, alignItems: 'flex-start' },
  storyEyebrow: { color: colors.white, fontFamily: fonts.sansBold, fontSize: 11, letterSpacing: 1.4, textTransform: 'uppercase' },
  storyTitle: { maxWidth: 310, color: colors.white, fontFamily: fonts.display, fontSize: 38, lineHeight: 41, letterSpacing: -1 },
  storyBody: { maxWidth: 300, color: colors.white, fontFamily: fonts.sansMedium, fontSize: 14, lineHeight: 20 },
  storyButton: { minHeight: 46, borderRadius: radius.pill, backgroundColor: colors.white, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.lg },
  storyButtonText: { color: colors.ink900, fontFamily: fonts.sansBold, fontSize: 15 },

  sectionHeader: { paddingHorizontal: spacing.lg, paddingTop: spacing.xl, gap: spacing.xs },
  pill: {
    alignSelf: 'flex-start',
    borderRadius: radius.sm,
    backgroundColor: colors.brand100,
    paddingHorizontal: spacing.sm,
    paddingVertical: 5,
  },
  pillText: { color: colors.brand700, fontFamily: fonts.sansBold, fontSize: 13 },
  sectionTitle: {
    color: colors.ink900,
    fontFamily: fonts.display,
    fontSize: 40,
    lineHeight: 44,
    letterSpacing: -1.2,
  },
  sectionBody: { color: colors.ink700, fontFamily: fonts.sans, fontSize: 16, lineHeight: 23 },

  feature: { minHeight: 200, marginTop: spacing.lg, flexDirection: 'row', alignItems: 'center' },
  featureFlip: { flexDirection: 'row-reverse' },
  featureImage: { width: 164, height: 186 },
  // Bleeds past the screen edge so it reads as a photograph, not a card.
  featureImageLeft: { marginLeft: -32, borderTopRightRadius: 999, borderBottomRightRadius: 999 },
  featureImageRight: { marginRight: -32, borderTopLeftRadius: 999, borderBottomLeftRadius: 999 },
  featureCopy: { flex: 1, paddingHorizontal: spacing.lg, gap: 6 },
  tag: {
    alignSelf: 'flex-start',
    borderRadius: radius.sm,
    backgroundColor: colors.brand50,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
  },
  tagText: { color: colors.brand700, fontFamily: fonts.sansBold, fontSize: 12 },
  featureTitle: {
    color: colors.ink900,
    fontFamily: fonts.display,
    fontSize: 26,
    lineHeight: 30,
    letterSpacing: -0.6,
  },
  featureFrom: { color: colors.ink500, fontFamily: fonts.sans, fontSize: 14 },

  // The glass shelf. It borrows every style above and changes only the media
  // slot, because a cut-out cannot be the half-capsule -- it has to stand on
  // one. Every number here is derived in `@/features/glass-feature`, which
  // tests the relationships between them.
  glassFeature: { minHeight: SLOT_HEIGHT },
  glassSlot: { width: SLOT_WIDTH, height: SLOT_HEIGHT },
  glassSlotLeft: { marginLeft: -BLEED },
  glassSlotRight: { marginRight: -BLEED },
  // The ground the glass stands on: the same half-capsule the photographic rows
  // cut out of their own pixels, drawn as a shape because a cut-out has none.
  // A flat fill would make the glass look pasted onto a token, so it is a wash
  // that is fully present at the bleeding edge and dissolves into the surface
  // where it would otherwise fight the copy column. overflow hidden so the
  // gradient respects the 999 corners.
  glassGround: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: GROUND_TOP,
    height: GROUND_HEIGHT,
    overflow: 'hidden',
  },
  glassGroundLeft: { borderTopRightRadius: 999, borderBottomRightRadius: 999 },
  glassGroundRight: { borderTopLeftRadius: 999, borderBottomLeftRadius: 999 },
  // No blur: brand300 on brand100 is a small enough tonal step that a hard edge
  // is not readable as an edge, and blur is the most expensive thing to animate.
  glassShadow: {
    position: 'absolute',
    bottom: SHADOW_BOTTOM,
    width: SHADOW_WIDTH,
    height: SHADOW_HEIGHT,
    borderRadius: 999,
    backgroundColor: colors.brand300,
  },
  glassShadowLeft: { left: SHADOW_INSET_X },
  glassShadowRight: { right: SHADOW_INSET_X },
  glassLift: { position: 'absolute', top: GLASS_TOP, width: GLASS_BOX_WIDTH, height: GLASS_BOX_HEIGHT },
  glassLiftLeft: { left: GLASS_INSET_X },
  glassLiftRight: { right: GLASS_INSET_X },
  glassImage: { width: GLASS_BOX_WIDTH, height: GLASS_BOX_HEIGHT },
  learnMore: { color: colors.ink900, fontFamily: fonts.sansBold, fontSize: 15, marginTop: 2 },

  categorySection: { paddingTop: spacing.lg },
  categoryHeader: {
    paddingHorizontal: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  categoryHeaderCopy: { flex: 1, minWidth: 0, gap: 2 },
  categoryTitle: { color: colors.ink900, fontFamily: fonts.display, fontSize: 26, lineHeight: 30, letterSpacing: -0.5 },
  categoryTagline: { color: colors.ink500, fontFamily: fonts.sans, fontSize: 13 },
  categoryCount: {
    color: colors.brand700,
    fontFamily: fonts.sansBold,
    fontSize: 13,
    backgroundColor: colors.brand100,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    overflow: 'hidden',
  },
  menuList: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
  menuRow: {
    minHeight: 76,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.ink200,
    paddingVertical: spacing.sm,
  },
  menuRowCopy: { flex: 1, minWidth: 0, gap: 2 },
  menuRowName: { color: colors.ink900, fontFamily: fonts.sansBold, fontSize: 15 },
  menuRowBody: { color: colors.ink500, fontFamily: fonts.sans, fontSize: 12.5 },
  menuRowPrice: { color: colors.ink900, fontFamily: fonts.display, fontSize: 17 },
  showAllButton: {
    alignSelf: 'center',
    marginTop: spacing.sm,
    minHeight: 44,
    borderRadius: radius.pill,
    backgroundColor: colors.brand50,
    borderWidth: 1,
    borderColor: colors.brand200,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.lg,
  },
  showAllText: { color: colors.brand700, fontFamily: fonts.sansBold, fontSize: 14 },

  addOns: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, gap: spacing.sm },
  addOnRow: {
    minHeight: 66,
    borderRadius: radius.md,
    backgroundColor: colors.brand50,
    paddingHorizontal: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  addOnCopy: { flex: 1, gap: 2 },
  addOnName: { color: colors.ink900, fontFamily: fonts.sansBold, fontSize: 16 },
  addOnBody: { color: colors.ink500, fontFamily: fonts.sans, fontSize: 13 },
  addOnPrice: { color: colors.ink900, fontFamily: fonts.display, fontSize: 19 },

  siriWrap: { paddingHorizontal: spacing.lg, paddingTop: spacing.xl },
  footerCtaSpace: { height: spacing.xl + 48 },
  stickyCtaWrap: {
    position: 'absolute',
    left: spacing.lg,
    right: spacing.lg,
    zIndex: 40,
    // Centered content width, matching the hero pill above.
    alignItems: 'center',
  },
  stickyBookNowButton: {
    minHeight: 46,
    borderRadius: radius.pill,
    backgroundColor: colors.brand600,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  stickyBookNowText: {
    color: colors.white,
    fontFamily: fonts.sansBold,
    fontSize: 15,
  },
  stickyBookNowWait: {
    color: 'rgba(255,255,255,0.82)',
    fontFamily: fonts.sansMedium,
    fontSize: 13,
  },
});
