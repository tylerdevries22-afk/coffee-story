import { Pressable, Text, View, type LayoutChangeEvent } from 'react-native';

import { SiriAssistant, type SiriCommand } from '@/components/siri/siri-assistant';
import type { MenuCategoryId } from '@/data/catalog';
import { useAppState } from '@/state/app-context';
import { useCustomerCatalog } from '@/state/catalog-context';
import { AppIcon, useTokens as useBrandTokens } from '@platform/ui';

import { HOME_COPY, IS_PROJECT_BUSINESS } from './home-content';
import { MenuRow, SectionHeader } from './home-feature-rows';
import { createHomeStyles } from './home-screen.styles';

const CATEGORY_PREVIEW_COUNT = 7;

export function HomeCatalogSections({ expanded, onCategoryLayout, onToggleCategory, showAssistant, onCloseAssistant }: {
  expanded: ReadonlySet<MenuCategoryId>;
  onCategoryLayout: (category: MenuCategoryId, event: LayoutChangeEvent) => void;
  onToggleCategory: (category: MenuCategoryId) => void;
  showAssistant: boolean;
  onCloseAssistant: () => void;
}) {
  const tokens = useBrandTokens();
  const styles = createHomeStyles(tokens);
  const { openMore, setClientTab, startOrder } = useAppState();
  const { items: menuItems, categories: menuCategories, addOns: menuAddOns } = useCustomerCatalog();
  const siriCommands: readonly SiriCommand[] = IS_PROJECT_BUSINESS ? [
    { key: 'book', phrase: 'Start a project', onRun: () => startOrder() },
    { key: 'next-order', phrase: 'Show my project status', onRun: () => openMore('orders') },
    { key: 'support', phrase: 'Contact my project team', onRun: () => openMore('messages') },
  ] : [
    { key: 'book', phrase: 'Order my usual', onRun: () => startOrder() },
    { key: 'next-order', phrase: 'When is my next pickup?', onRun: () => openMore('orders') },
    { key: 'rewards', phrase: 'Check my rewards balance', onRun: () => setClientTab('rewards') },
    { key: 'gift', phrase: 'Send a gift card', onRun: () => setClientTab('gift') },
  ];
  const toggleCategory = onToggleCategory;
  return (
    <>
      <SectionHeader
        pill={HOME_COPY.catalogPill}
        title={HOME_COPY.catalogTitle}
        body={HOME_COPY.catalogBody}
      />
      {menuCategories.map((category) => {
        const items = menuItems.filter((item) => item.category === category.id);
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
                <AppIcon name={isExpanded ? 'chevron.up' : 'chevron.down'} size={13} tintColor={tokens.primary} />
              </Pressable>
            ) : null}
          </View>
        );
      })}

      {menuAddOns.length > 0 ? (
        <>
          <SectionHeader
            pill="Make It Yours"
            title="Add-Ons"
            body="Small additions that make a cup feel like your own."
          />
          <View style={styles.addOns}>
            {menuAddOns.map((addOn) => (
              <View key={addOn.slug} style={styles.addOnRow}>
                <View style={styles.addOnCopy}>
                  <Text style={styles.addOnName}>{addOn.name}</Text>
                  <Text style={styles.addOnBody}>{addOn.description}</Text>
                </View>
                <Text style={styles.addOnPrice}>${(addOn.priceCents / 100).toFixed(2).replace(/\.00$/, '')}</Text>
              </View>
            ))}
          </View>
        </>
      ) : null}

      {showAssistant ? (
        <View style={styles.siriWrap}>
          <SiriAssistant commands={siriCommands} onClose={() => onCloseAssistant()} />
        </View>
      ) : null}

      {/* Preserve the final breathing room without rendering a second CTA. */}
      <View style={styles.footerCtaSpace} accessible={false} />
    </>
  );
}
