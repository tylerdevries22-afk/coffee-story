import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';


import { AppIcon } from '@/components/icon';
import { useTabBarClearance } from '@/components/navigation/tab-screen';
import { Screen } from '@/components/ui';
import { DEMO_ADD_ONS, SERVICES, type Service } from '@/data/catalog';
import { useAppState } from '@/state/app-context';
import { useAuth } from '@/state/auth-context';
import { mobileApi } from '@/lib/mobile-api';
import { openWebPath } from '@/lib/web-navigation';
import { colors, fonts, radius, spacing } from '@/theme/tokens';
import { useReducedMotion } from '@/hooks/use-reduced-motion';

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

/**
 * Client home, laid out like the Crumbl app home: a full-bleed hero with the
 * CTA sitting on the media, then dated section headers introducing alternating
 * feature rows whose imagery bleeds off the screen edge.
 */
export function HomeScreen() {
  const { setClientTab, startBooking } = useAppState();
  const { portal } = useAuth();
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const tabBarClearance = useTabBarClearance(24);
  const reducedMotion = useReducedMotion();
  const [scrollY] = useState(() => new Animated.Value(0));
  const [carouselX] = useState(() => new Animated.Value(0));
  const [activeSlide, setActiveSlide] = useState(0);
  const stickyVisible = useRef(false);
  const [showStickyCta, setShowStickyCta] = useState(false);
  const [overHero, setOverHero] = useState(true);
  const firstService = SERVICES[0];
  const nextOpeningService =
    firstService?.id && firstService.durations?.[0]?.minutes
      ? `${firstService.id}-${firstService.durations[0].minutes}`
      : null;
  const nextOpeningBookingService = SERVICES[0]?.id ?? null;
  const [nextOpening, setNextOpening] = useState(nextOpeningService ? 'Loading next availability' : 'Current availability');
  const [loadingNextOpening, setLoadingNextOpening] = useState(Boolean(nextOpeningService));
  const firstName = portal.profile.fullName.split(/\s+/)[0] || 'there';
  const heroHeight = Math.round(width * 1.05) + insets.top * 2;

  const player = useVideoPlayer(heroVideo, (instance) => {
    instance.loop = true;
    instance.muted = true;
    instance.play();
  });

  const featured = SERVICES.slice(0, 2);
  const classics = SERVICES.slice(2);

  const onScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const offset = event.nativeEvent.contentOffset.y;
    scrollY.setValue(offset);
    const nextVisible = offset > 96;
    if (nextVisible !== stickyVisible.current) {
      stickyVisible.current = nextVisible;
      setShowStickyCta(nextVisible);
    }
    // The status bar inverts only while the hero runs underneath it.
    setOverHero(offset < heroHeight - insets.top - 72);
  }, [heroHeight, insets.top, scrollY]);
  const stickyProgress = scrollY.interpolate({
    inputRange: [72, 128],
    outputRange: [0, 1],
    extrapolate: 'clamp',
  });

  const onBookNow = useCallback(() => {
    startBooking(nextOpeningBookingService ?? undefined);
  }, [startBooking, nextOpeningBookingService]);

  const onOpenPackages = useCallback(() => {
    void openWebPath('/menu').catch((error: unknown) => {
      Alert.alert('Bundles unavailable', error instanceof Error ? error.message : 'Try again in a moment.');
    });
  }, []);

  const formatNextOpening = useCallback((isoDate: string | null, tz?: string) => {
    const nextDate = new Date(isoDate ?? "");
    if (Number.isNaN(nextDate.getTime())) {
      return "Current availability";
    }

    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: tz ?? "America/Denver",
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
    return formatter.format(nextDate).replace(", ", " ");
  }, []);

  useEffect(() => {
    let active = true;
    void (async () => {
      if (!nextOpeningService) return;

      setLoadingNextOpening(true);
      try {
        const payload = await mobileApi.nextSlot(nextOpeningService, [], 14);
        if (!active) return;

        if (!payload.nextSlot) {
          setNextOpening("Next window soon");
          return;
        }

        setNextOpening(formatNextOpening(payload.nextSlot, payload.tz));
      } catch {
        if (active) {
          setNextOpening("Current availability");
        }
      } finally {
        if (active) {
          setLoadingNextOpening(false);
        }
      }
    })();

    return () => {
      active = false;
    };
  }, [formatNextOpening, nextOpeningService]);

  return (
    <View style={styles.shell}>
      <StatusBar style={overHero ? 'light' : 'dark'} />
      <Screen
        style={styles.screen}
        contentContainerStyle={styles.content}
        contentInsetAdjustmentBehavior="never"
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
                      accessibilityLabel="Inside the Coffee Story café on Havana Street"
                    />
                  ) : (
                    <Image
                      source={slide === 'packages' ? packagesMedia : giftingMedia}
                      style={StyleSheet.absoluteFill}
                      contentFit="cover"
                      alt={slide === 'packages' ? 'Coffee beans and bundles ready for pickup' : 'A Coffee Story gift card design'}
                    />
                  )}
                </Animated.View>
                <LinearGradient
                  pointerEvents="none"
                  colors={['rgba(36,24,41,0.38)', 'rgba(36,24,41,0.02)', 'rgba(36,24,41,0.56)']}
                  locations={[0, 0.42, 1]}
                  style={StyleSheet.absoluteFill}
                />
                {slide === 'opening' ? (
                  <View style={styles.openingContent}>
                    <NextOpeningPill
                      nextOpening={nextOpening}
                      isLoading={loadingNextOpening}
                      onPress={onBookNow}
                    />
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
                      accessibilityLabel="Send a Coffee Story gift card"
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

      <SectionHeader
        pill={`Welcome back, ${firstName}`}
        title="House Favorites"
        body="The drinks Aurora keeps coming back for — handcrafted on Corvus Coffee."
      />
      {featured.map((service, index) => (
        <FeatureRow
          key={service.id}
          service={service}
          tag="Most Loved"
          flip={index % 2 === 1}
          onPress={() => startBooking(service.id)}
        />
      ))}

      <SectionHeader
        pill="Always Available"
        title="The Classics"
        body="From Turkish coffee to cold brew — these are here to stay, all day until 11 PM."
      />
      {classics.map((service, index) => (
        <FeatureRow
          key={service.id}
          service={service}
          tag="Always Available"
          flip={index % 2 === 1}
          onPress={() => startBooking(service.id)}
        />
      ))}

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
            <Text style={styles.addOnPrice}>${(addOn.priceCents / 100).toFixed(0)}</Text>
          </View>
        ))}
      </View>

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
          accessibilityLabel="Start your order"
          onPress={onBookNow}
          style={({ pressed }) => [styles.stickyBookNowButton, pressed && styles.pressed]}
        >
          <Text style={styles.stickyBookNowText}>Order Now</Text>
          <AppIcon name="chevron.right" size={14} tintColor={colors.white} />
        </Pressable>
      </Animated.View>
    </View>
  );
}

function NextOpeningPill({
  nextOpening,
  onPress,
  isLoading,
}: {
  nextOpening: string;
  onPress: () => void;
  isLoading: boolean;
}) {
  return (
    <View style={styles.nextOpeningPill}>
      <View style={styles.nextOpeningInfoWrap}>
        <View style={styles.nextOpeningDot} />
        <View style={styles.nextOpeningCopy}>
          <Text style={styles.nextOpeningLabel}>Next pickup window</Text>
          <Text style={styles.nextOpeningValue} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.82}>
            {isLoading ? 'Loading…' : nextOpening}
          </Text>
        </View>
      </View>
      <View style={styles.nextOpeningDivider} />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Start your order"
        onPress={onPress}
        style={({ pressed }) => [styles.nextOpeningCta, pressed && styles.pressed]}
      >
        <Text style={styles.nextOpeningCtaText}>Order Now</Text>
        <AppIcon name="chevron.right" size={14} tintColor={colors.white} />
      </Pressable>
    </View>
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
  service,
  tag,
  flip,
  onPress,
}: {
  service: Service;
  tag: string;
  flip: boolean;
  onPress: () => void;
}) {
  const from = service.durations[0]?.price;
  return (
    <View style={[styles.feature, flip && styles.featureFlip]}>
      <Image
        source={service.image}
        style={[styles.featureImage, flip ? styles.featureImageRight : styles.featureImageLeft]}
        contentFit="cover"
        alt={service.name}
      />
      <View style={styles.featureCopy}>
        <View style={styles.tag}><Text style={styles.tagText}>{tag}</Text></View>
        <Text style={styles.featureTitle}>{service.name}</Text>
        {from ? <Text style={styles.featureFrom}>From ${from}</Text> : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Learn more about ${service.name}`}
          onPress={onPress}
        >
          <Text style={styles.learnMore}>Learn More  ›</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  shell: { flex: 1 },
  screen: { backgroundColor: colors.surface },
  content: { paddingTop: 0, paddingHorizontal: 0, paddingBottom: 150, gap: 0 },
  // overflow hidden keeps the video inside the hero box: on web an absolutely
  // filled child otherwise paints behind the whole page.
  hero: { width: '100%', backgroundColor: colors.brand100, overflow: 'hidden' },
  heroSlide: { height: '100%', overflow: 'hidden' },
  heroMedia: { position: 'absolute', top: 0, bottom: 0, left: '-14%', right: '-14%' },
  openingContent: { position: 'absolute', left: spacing.lg, right: spacing.lg, bottom: 42 },
  nextOpeningPill: {
    flexDirection: 'row',
    overflow: 'hidden',
    minHeight: 52,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.white,
    backgroundColor: 'rgba(255, 255, 255, 0.93)',
  },
  nextOpeningInfoWrap: {
    flex: 1,
    minWidth: 0,
    paddingLeft: spacing.md,
    paddingRight: spacing.sm,
    paddingVertical: spacing.xs,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  nextOpeningCopy: { flex: 1, minWidth: 0 },
  nextOpeningDot: {
    width: 8,
    height: 8,
    borderRadius: 8,
    backgroundColor: colors.success,
  },
  nextOpeningLabel: {
    color: colors.ink600,
    fontFamily: fonts.sansBold,
    fontSize: 10,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  nextOpeningValue: {
    color: colors.ink900,
    fontFamily: fonts.sansBold,
    fontSize: 14,
    lineHeight: 18,
  },
  nextOpeningDivider: {
    width: 1,
    backgroundColor: colors.ink200,
  },
  nextOpeningCta: {
    width: 112,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 7,
    backgroundColor: colors.brand600,
    paddingHorizontal: spacing.md,
    minHeight: 52,
  },
  nextOpeningCtaText: {
    color: colors.white,
    fontFamily: fonts.sansBold,
    fontSize: 15,
  },
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
    backgroundColor: 'rgba(255,252,254,0.94)',
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
  learnMore: { color: colors.ink900, fontFamily: fonts.sansBold, fontSize: 15, marginTop: 2 },

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

  footerCtaSpace: { height: spacing.xl + 48 },
  stickyCtaWrap: {
    position: 'absolute',
    left: spacing.lg,
    right: spacing.lg,
    zIndex: 40,
    alignItems: 'stretch',
  },
  stickyBookNowButton: {
    minHeight: 56,
    borderRadius: radius.pill,
    backgroundColor: colors.brand600,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.xl,
  },
  stickyBookNowText: {
    color: colors.white,
    fontFamily: fonts.sansBold,
    fontSize: 17,
  },
});
