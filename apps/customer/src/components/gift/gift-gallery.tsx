import { Image } from 'expo-image';
import { useCallback, useState } from 'react';
import { Animated, Pressable, ScrollView, Text, View, useWindowDimensions, type NativeScrollEvent, type NativeSyntheticEvent, type StyleProp, type ViewStyle } from 'react-native';

import { CollapsingPageHeader } from '@/components/collapsing-page-header';
import { Screen } from '@/components/ui';
import { GIFT_DESIGN_CATEGORIES, type GiftDesign } from '@/data/gift-designs';
import { AppIcon, useTokens as useBrandTokens } from '@platform/ui';

import { createGiftStyles } from './gift-shelves.styles';

/** Gift-card artwork is 3:2, matching the generated art. */
const CARD_RATIO = 2 / 3;

/** The Gift tab's storefront: a wallet banner over shelves of card artwork. */
export function GiftGallery({
  walletCount,
  onOpenWallet,
  onOpenInfo,
  onSelectDesign,
}: {
  walletCount: number;
  onOpenWallet: () => void;
  onOpenInfo: () => void;
  onSelectDesign: (design: GiftDesign) => void;
}) {
  const tokens = useBrandTokens();
  const styles = createGiftStyles(tokens);
  const [scrollY] = useState(() => new Animated.Value(0));
  const { width } = useWindowDimensions();
  const compact = width < 360;
  const onScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    scrollY.setValue(event.nativeEvent.contentOffset.y);
  }, [scrollY]);

  return (
    <Screen
      contentContainerStyle={styles.galleryContent}
      stickyHeaderIndices={[0]}
      onScroll={onScroll}
      scrollEventThrottle={16}
    >
      <CollapsingPageHeader
        title="Gift Cards"
        scrollY={scrollY}
        flush
        actions={(
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="About digital gifting"
            onPress={onOpenInfo}
            hitSlop={8}
            style={({ pressed }) => [styles.infoButton, pressed && styles.pressed]}
          >
            <AppIcon name="info" size={20} tintColor={tokens.textPrimary} />
          </Pressable>
        )}
      />

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`My gift cards, ${walletCount} in your account`}
        onPress={onOpenWallet}
        style={({ pressed }) => [styles.wallet, compact && styles.walletCompact, pressed && styles.pressed]}
      >
        <View style={styles.walletCopy}>
          <Text style={styles.walletTitle}>My Gift Cards</Text>
          <Text style={styles.walletBody}>
            {walletCount
              ? `${walletCount} card${walletCount === 1 ? '' : 's'} in your account`
              : 'Digital gift cards you purchase and receive will appear here'}
          </Text>
        </View>
        <WalletStack compact={compact} />
      </Pressable>

      {GIFT_DESIGN_CATEGORIES.map((category) => (
        <GiftShelf key={category.title} title={category.title} designs={category.designs} compact={compact} onSelect={onSelectDesign} />
      ))}
    </Screen>
  );
}

/** The fanned card thumbnails on the wallet banner. Decorative only. */
function WalletStack({ compact }: { compact: boolean }) {
  const tokens = useBrandTokens();
  const styles = createGiftStyles(tokens);
  const [back, middle, front] = [
    GIFT_DESIGN_CATEGORIES[1]?.designs[0],
    GIFT_DESIGN_CATEGORIES[3]?.designs[0],
    GIFT_DESIGN_CATEGORIES[0]?.designs[0],
  ];
  return (
    <View style={[styles.stack, compact && styles.stackCompact]} pointerEvents="none">
      <StackCard design={back} placement={styles.stackBack} compact={compact} />
      <StackCard design={middle} placement={styles.stackMiddle} compact={compact} />
      <StackCard design={front} placement={styles.stackFront} compact={compact} />
    </View>
  );
}

function StackCard({ design, placement, compact }: { design?: GiftDesign; placement: StyleProp<ViewStyle>; compact: boolean }) {
  const tokens = useBrandTokens();
  const styles = createGiftStyles(tokens);
  if (!design) return null;
  return (
    <View style={[styles.stackCard, compact && styles.stackCardCompact, placement]}>
      <Image source={design.art} style={styles.fillImage} contentFit="cover" alt="" />
    </View>
  );
}

function GiftShelf({
  title,
  designs,
  compact,
  onSelect,
}: {
  title: string;
  designs: readonly GiftDesign[];
  compact: boolean;
  onSelect: (design: GiftDesign) => void;
}) {
  const tokens = useBrandTokens();
  const styles = createGiftStyles(tokens);
  const { width } = useWindowDimensions();
  // Leaves the next card peeking, which is what invites the shelf to be scrolled.
  const cardWidth = Math.min(288, Math.round(width * 0.72));
  return (
    <View style={styles.shelf}>
      <Text accessibilityRole="header" style={[styles.shelfTitle, compact && styles.shelfInsetCompact]}>
        {title}
      </Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={[styles.shelfRow, compact && styles.shelfInsetCompact]}
      >
        {designs.map((design) => (
          <Pressable
            key={design.key}
            accessibilityRole="button"
            accessibilityLabel={`${design.name} gift card`}
            onPress={() => onSelect(design)}
            style={({ pressed }) => [
              styles.shelfCard,
              { width: cardWidth, height: Math.round(cardWidth * CARD_RATIO) },
              pressed && styles.pressed,
            ]}
          >
            <Image source={design.art} style={styles.fillImage} contentFit="cover" alt={design.name} />
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}
