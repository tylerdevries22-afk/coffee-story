import { useMemo } from 'react';
import { Animated, Pressable, Text, View } from 'react-native';

import { productCutoutSource, type ProductCutoutSource } from '@/components/product-cutout';
import type { MenuItem } from '@/data/catalog';
import { dropWindowLabel, weeklyDrops, type Drop } from '@/features/drops';
import {
  TEA_MATCHA_CATEGORY, TEA_MATCHA_SHELF_SIZE, teaMatchaCount,
  teaMatchaSeeAllLabel, teaMatchaShelf, teaMatchaTag,
} from '@/features/tea-matcha';
import { useAppState } from '@/state/app-context';
import { useAuth } from '@/state/auth-context';
import { useCustomerCatalog } from '@/state/catalog-context';
import { TENANT, tenantFeature } from '@/tenant';
import { TENANT_PRODUCT_MEDIA } from '@/tenant/product-media';
import { cutoutFeatureLineup, resolveProductMedia } from '@platform/domain';
import { useTokens as useBrandTokens } from '@platform/ui';

import { DropFeatureRow, FeatureRow, SectionHeader } from './home-feature-rows';
import { GlassFeatureRow } from './home-glass-feature';
import { HOME_COPY } from './home-content';
import { createHomeStyles } from './home-screen.styles';

export function HomeFeatureSections({ scrollY, viewportHeight, reducedMotion, onSeeAllTea }: {
  scrollY: Animated.Value;
  viewportHeight: number;
  reducedMotion: boolean;
  onSeeAllTea: () => void;
}) {
  const tokens = useBrandTokens();
  const styles = createHomeStyles(tokens);
  const { openMore, startOrder } = useAppState();
  const { portal } = useAuth();
  const { items: menuItems, categories: menuCategories, drops } = useCustomerCatalog();
  const firstName = portal.profile.fullName.split(/\s+/)[0] || 'there';
  const favorites = menuItems.slice(0, 2);
  const weekly = useMemo(() => {
    if (!tenantFeature('drops')) return [];
    return weeklyDrops(drops, new Date())
      .map((entry) => ({ drop: entry, item: menuItems.find((item) => item.id === entry.itemId) ?? null }))
      .filter((entry): entry is { drop: Drop; item: MenuItem } => entry.item !== null);
  }, [drops, menuItems]);
  const teaShelf = useMemo(() => {
    const curated = teaMatchaShelf(menuItems);
    const { shown } = cutoutFeatureLineup(
      curated.map((item) => item.id), TENANT_PRODUCT_MEDIA, TEA_MATCHA_SHELF_SIZE,
    );
    return shown.map((id) => {
      const item = curated.find((entry) => entry.id === id);
      const ref = resolveProductMedia(id, TENANT_PRODUCT_MEDIA);
      const glass = ref ? productCutoutSource(ref) : null;
      return item && glass ? { ...item, glass } : null;
    }).filter((entry): entry is MenuItem & { glass: ProductCutoutSource } => entry !== null);
  }, [menuItems]);
  const teaCount = useMemo(() => teaMatchaCount(menuItems), [menuItems]);
  const teaMeta = menuCategories.find((category) => category.id === TEA_MATCHA_CATEGORY) ?? {
    id: TEA_MATCHA_CATEGORY, title: 'Tea & Matcha', tagline: '',
  };
  return (
    <>
      {weekly.length ? (
        <View style={styles.dropSection}>
          {/* The dated drop board: a date-range chip over a generic section
              title, then each drop as an alternating edge-bleed feature row —
              the same header + staggered-row grammar as the rest of the page,
              so a second drop in the window slots in without a new layout. */}
          <SectionHeader
            pill={dropWindowLabel(weekly.map((entry) => entry.drop), TENANT.location.timezone)}
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
        title={HOME_COPY.favoritesTitle}
        body={HOME_COPY.favoritesBody}
      />
      {favorites.map((item, index) => (
        <FeatureRow
          key={item.id}
          item={item}
          tag={HOME_COPY.favoriteTag}
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
              viewportHeight={viewportHeight}
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
    </>
  );
}
