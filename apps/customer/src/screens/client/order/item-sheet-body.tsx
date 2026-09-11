import * as Haptics from 'expo-haptics';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { MenuImage } from '@/components/menu-image';
import { OptionGroupField, QuantityStepper, SizeSegmented } from '@/components/order/option-controls';
import { ActionButton, useCoveringBottomInset } from '@/components/order/order-chrome';
import type { MenuItem } from '@/data/catalog';
import {
  MAX_LINE_QUANTITY,
  buildOrderLine,
  defaultOptionSelection,
  defaultSizeSlug,
  formatMoney,
  missingRequiredGroups,
  optionDeltaCents,
  sizeLabel,
  sizePriceCents,
  toggleOptionChoice,
  visibleOptionGroups,
  type OptionSelection,
  type OrderLine,
} from '@platform/domain';
import { AppIcon, useTokens as useBrandTokens } from '@platform/ui';

import { createStyles } from './item-sheet-styles';

export function ItemSheetBody({
  item,
  onClose,
  onAdd,
}: {
  item: MenuItem;
  onClose: () => void;
  onAdd: (line: OrderLine) => number;
}) {
  const tokens = useBrandTokens();
  const styles = createStyles(tokens);
  const bottom = useCoveringBottomInset();
  const groups = useMemo(() => [...item.optionGroups], [item.optionGroups]);
  const [sizeSlug, setSizeSlug] = useState(() => defaultSizeSlug(item.sizes));
  const [selection, setSelection] = useState<OptionSelection>(() => defaultOptionSelection(groups));
  const [quantity, setQuantity] = useState(1);
  const [showRequired, setShowRequired] = useState(false);
  const [shortfall, setShortfall] = useState<number | null>(null);

  const size = item.sizes.find((entry) => entry.slug === sizeSlug) ?? item.sizes[0];
  const basePriceCents = size ? sizePriceCents(size) : 0;
  const unitPriceCents = basePriceCents + optionDeltaCents(groups, selection);
  const missing = missingRequiredGroups(groups, selection);
  const visible = visibleOptionGroups(groups, selection);

  const sizes = item.sizes.map((entry) => ({
    slug: entry.slug,
    label: sizeLabel(entry),
    priceCents: sizePriceCents(entry),
  }));

  function add() {
    // Belt and braces with the menu row's disabled state: an 86'd item can
    // still be reached through a stale deep link or a tap raced with a menu
    // refresh, and it must not land in the bag.
    if (item.soldOutToday) return;
    if (missing.length > 0) {
      setShowRequired(true);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => undefined);
      return;
    }
    if (!size) return;
    const added = onAdd(buildOrderLine({
      itemId: item.id,
      name: item.name,
      sizeSlug: size.slug,
      sizeLabel: sizeLabel(size),
      basePriceCents,
      groups,
      selection,
      quantity,
    }));
    // The bag caps one line at MAX_LINE_QUANTITY. Closing on a success haptic
    // when fewer went in than the button quoted would drop drinks the guest
    // had just been given a price for, with no message anywhere in the flow.
    if (added < quantity) {
      setShortfall(added);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => undefined);
      return;
    }
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
  }

  return (
    <View style={styles.body}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.hero}>
          <MenuImage source={item.image} variant="hero" alt="" />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Close ${item.name}`}
            hitSlop={8}
            onPress={onClose}
            style={({ pressed }) => [styles.close, pressed && styles.pressed]}
          >
            <AppIcon name="xmark" size={17} tintColor={tokens.textPrimary} weight="bold" />
          </Pressable>
        </View>

        <View style={styles.copy}>
          <Text accessibilityRole="header" style={styles.name}>{item.name}</Text>
          <Text style={styles.description}>{item.description}</Text>
        </View>

        {sizes.length > 1 ? (
          <View style={styles.block}>
            <Text style={styles.blockTitle}>Size</Text>
            <SizeSegmented
              sizes={sizes}
              value={sizeSlug}
              // A different size is a different line, so whatever the last
              // size could not fit says nothing about this one.
              onChange={(slug) => {
                setShortfall(null);
                setSizeSlug(slug);
              }}
            />
          </View>
        ) : null}

        {visible.map((group) => (
          <View key={group.id} style={styles.block}>
            <OptionGroupField
              group={group}
              selection={selection}
              onToggle={(groupId, choiceId) => {
                setShowRequired(false);
                setShortfall(null);
                setSelection((current) => toggleOptionChoice(groups, current, groupId, choiceId));
              }}
            />
          </View>
        ))}

        <View style={[styles.block, styles.quantityBlock]}>
          <Text style={styles.blockTitle}>Quantity</Text>
          <QuantityStepper
            quantity={quantity}
            min={1}
            max={MAX_LINE_QUANTITY}
            itemLabel={item.name}
            onDecrease={() => {
              setShortfall(null);
              setQuantity((current) => Math.max(1, current - 1));
            }}
            onIncrease={() => {
              setShortfall(null);
              setQuantity((current) => Math.min(MAX_LINE_QUANTITY, current + 1));
            }}
          />
        </View>

        {showRequired && missing.length > 0 ? (
          <Text accessibilityRole="alert" style={styles.error}>
            Choose {missing.map((group) => group.name.toLowerCase()).join(' and ')} first.
          </Text>
        ) : null}

        {shortfall !== null ? (
          <Text accessibilityRole="alert" style={styles.error}>
            {shortfall === 0
              ? `Your bag already holds ${MAX_LINE_QUANTITY} of these — the most we make to order. Call the shop for a larger run.`
              : `Only ${shortfall} more would fit; ${MAX_LINE_QUANTITY} per item is the most we make to order.`}
          </Text>
        ) : null}
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: bottom + tokens.spacing.md }]}>
        <ActionButton
          label={item.soldOutToday ? 'Sold out today' : quantity > 1 ? `Add ${quantity} to Bag` : 'Add to Bag'}
          value={item.soldOutToday ? undefined : formatMoney(unitPriceCents * quantity)}
          disabled={Boolean(item.soldOutToday)}
          onPress={add}
          accessibilityHint={
            missing.length > 0
              ? `Choose ${missing.map((group) => group.name.toLowerCase()).join(' and ')} first`
              : undefined
          }
        />
      </View>
    </View>
  );
}
