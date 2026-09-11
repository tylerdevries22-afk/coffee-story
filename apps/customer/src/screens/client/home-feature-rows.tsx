import { Pressable, Text, View } from 'react-native';

import { MenuImage } from '@/components/menu-image';
import type { MenuItem } from '@/data/catalog';
import { dropStatus, type Drop } from '@/features/drops';
import { ACTION_LABEL } from './home-content';
import { AppIcon, DropCountdown, disabledState, useTokens as useBrandTokens } from '@platform/ui';
import { formatMoney } from '@platform/domain';

import { createHomeStyles } from './home-screen.styles';

export function SectionHeader({ pill, title, body }: { pill: string; title: string; body: string }) {
  const tokens = useBrandTokens();
  const styles = createHomeStyles(tokens);
  return (
    <View style={styles.sectionHeader}>
      <View style={styles.pill}><Text style={styles.pillText}>{pill}</Text></View>
      <Text accessibilityRole="header" style={styles.sectionTitle}>{title}</Text>
      <Text style={styles.sectionBody}>{body}</Text>
    </View>
  );
}

export function FeatureRow({
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
  const tokens = useBrandTokens();
  const styles = createHomeStyles(tokens);
  const from = item.sizes[0]?.priceCents;
  return (
    <View style={[styles.feature, flip && styles.featureFlip]}>
      <MenuImage
        source={item.image}
        variant="hero"
        style={[styles.featureImage, flip ? styles.featureImageRight : styles.featureImageLeft]}
        alt={item.name}
      />
      <View style={styles.featureCopy}>
        <View style={styles.tag}><Text style={styles.tagText}>{tag}</Text></View>
        <Text style={styles.featureTitle}>{item.name}</Text>
        {from ? <Text style={styles.featureFrom}>From {formatMoney(from)}</Text> : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${ACTION_LABEL}: ${item.name}`}
          onPress={onPress}
        >
          <Text style={styles.learnMore}>{ACTION_LABEL}  ›</Text>
        </Pressable>
      </View>
    </View>
  );
}

/** One drop on the weekly board, in the page's alternating feature grammar. */
export function DropFeatureRow({
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
  const tokens = useBrandTokens();
  const styles = createHomeStyles(tokens);
  const live = dropStatus(drop, new Date()) === 'live';
  return (
    <View style={[styles.feature, flip && styles.featureFlip]}>
      <MenuImage
        source={item.image}
        variant="hero"
        style={[styles.featureImage, flip ? styles.featureImageRight : styles.featureImageLeft]}
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

export function MenuRow({ item, onPress }: { item: MenuItem; onPress: () => void }) {
  const tokens = useBrandTokens();
  const styles = createHomeStyles(tokens);
  const from = item.sizes[0]?.priceCents;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${ACTION_LABEL}: ${item.name}`}
      onPress={onPress}
      style={({ pressed }) => [styles.menuRow, pressed && styles.pressed]}
    >
      <MenuImage source={item.image} variant="thumb" alt={item.name} />
      <View style={styles.menuRowCopy}>
        <Text style={styles.menuRowName}>{item.name}</Text>
        <Text numberOfLines={1} style={styles.menuRowBody}>{item.description}</Text>
      </View>
      {from ? <Text style={styles.menuRowPrice}>{formatMoney(from)}</Text> : null}
      <AppIcon name="chevron.right" size={13} tintColor={tokens.textMuted} />
    </Pressable>
  );
}
