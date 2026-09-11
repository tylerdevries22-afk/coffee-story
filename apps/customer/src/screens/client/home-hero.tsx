import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useState } from 'react';
import { Animated, Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { useAppState } from '@/state/app-context';
import { TENANT } from '@/tenant';
import { TENANT_MEDIA } from '@/tenants/media';
import { alpha, AppIcon, useReducedMotion, useTokens as useBrandTokens } from '@platform/ui';

import { HOME_COPY, HOME_PACKAGES, IS_PROJECT_BUSINESS } from './home-content';
import { BookNowPill } from './home-hero-controls';
import { createHomeStyles } from './home-screen.styles';

const HERO_SLIDES = ['opening', 'packages', 'gifting'] as const;
const heroVideo = TENANT_MEDIA.artwork['hero/home-hero.mp4'];
const packagesMedia = TENANT_MEDIA.artwork['hero/stones.webp'];
const giftingMedia = TENANT_MEDIA.artwork['gift/quiet-hour.webp'];

export function HomeHero({ width, heroHeight, insetTop, onBookNow, onOpenPackages }: {
  width: number;
  heroHeight: number;
  insetTop: number;
  onBookNow: () => void;
  onOpenPackages: () => void;
}) {
  const tokens = useBrandTokens();
  const styles = createHomeStyles(tokens);
  const reducedMotion = useReducedMotion();
  const { setClientTab, startOrder } = useAppState();
  const [carouselX] = useState(() => new Animated.Value(0));
  const [activeSlide, setActiveSlide] = useState(0);
  const player = useVideoPlayer(heroVideo, (instance) => {
    instance.loop = true;
    instance.muted = true;
    instance.play();
  });
  return (
      <View style={[styles.hero, { height: heroHeight, marginTop: -insetTop }]}>
        <Animated.ScrollView
          horizontal
          pagingEnabled
          bounces={false}
          decelerationRate="fast"
          showsHorizontalScrollIndicator={false}
          scrollEventThrottle={16}
          onScroll={Animated.event(
            [{ nativeEvent: { contentOffset: { x: carouselX } } }],
            { useNativeDriver: Platform.OS !== 'web' },
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
                      accessibilityLabel={HOME_COPY.openingAlt}
                    />
                  ) : (
                    <Image
                      source={slide === 'packages' ? packagesMedia : giftingMedia}
                      style={StyleSheet.absoluteFill}
                      contentFit="cover"
                      alt={slide === 'packages' && !IS_PROJECT_BUSINESS
                        ? 'Coffee beans and bundles ready for pickup' : HOME_COPY.mediaAlt}
                    />
                  )}
                </Animated.View>
                <LinearGradient
                  pointerEvents="none"
                  colors={[alpha(tokens.textPrimary, 0.38), alpha(tokens.textPrimary, 0.02), alpha(tokens.textPrimary, 0.56)]}
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
                        <Text style={styles.storyEyebrowDark}>{HOME_COPY.packageEyebrow}</Text>
                        <Text style={styles.packageTitle}>{HOME_COPY.packageTitle}</Text>
                      </View>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="View bundle details"
                        hitSlop={8}
                        onPress={onOpenPackages}
                        style={({ pressed }) => [styles.packageArrow, pressed && styles.pressed]}
                      >
                        <AppIcon name="chevron.right" size={16} tintColor={tokens.primary} />
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
                    <Text style={styles.storyEyebrow}>{TENANT.business.tagline}</Text>
                    <Text style={styles.storyTitle}>{HOME_COPY.supportTitle}</Text>
                    <Text style={styles.storyBody}>{HOME_COPY.supportBody}</Text>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={HOME_COPY.supportA11y}
                      onPress={() => IS_PROJECT_BUSINESS
                        ? startOrder('warranty-service-visit')
                        : setClientTab('gift')}
                      style={({ pressed }) => [styles.storyButton, pressed && styles.pressed]}
                    >
                      <Text style={styles.storyButtonText}>{HOME_COPY.supportAction}</Text>
                      <AppIcon name="chevron.right" size={14} tintColor={tokens.textPrimary} />
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
  );
}
