/**
 * The item detail sheet: hero, size, the item's own option groups, and a
 * button whose price moves as the guest customises.
 *
 * The sheet owns its own footer rather than the screen's sticky bar — it is
 * presented in a `Modal`, so a bar positioned against the screen would sit
 * behind it.
 */
import { Image } from 'expo-image';
import * as Haptics from 'expo-haptics';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { AppIcon } from '@/components/icon';
import { OptionGroupField, QuantityStepper, SizeSegmented } from '@/components/order/option-controls';
import { ActionButton, useCoveringBottomInset } from '@/components/order/order-chrome';
import { SheetModal } from '@/components/sheet-modal';
import type { Service } from '@/data/catalog';
import { formatMoney } from '@/features/money';
import { MAX_LINE_QUANTITY, buildOrderLine, type OrderLine } from '@/features/order/cart';
import {
  defaultOptionSelection,
  missingRequiredGroups,
  optionDeltaCents,
  optionGroupsFor,
  toggleOptionChoice,
  visibleOptionGroups,
  type OptionSelection,
} from '@/features/order/menu-options';
import { defaultSizeSlug, sizeLabelFor, sizePriceCents } from '@/features/order/sizes';
import { colors, fonts, radius, spacing } from '@/theme/tokens';

export function ItemSheet({
  item,
  onClose,
  onAdd,
}: {
  item: Service | null;
  onClose: () => void;
  onAdd: (line: OrderLine) => void;
}) {
  return (
    <SheetModal
      visible={item !== null}
      onRequestClose={onClose}
      sheetStyle={styles.sheet}
    >
      {item ? <ItemSheetBody key={item.id} item={item} onClose={onClose} onAdd={onAdd} /> : null}
    </SheetModal>
  );
}

function ItemSheetBody({
  item,
  onClose,
  onAdd,
}: {
  item: Service;
  onClose: () => void;
  onAdd: (line: OrderLine) => void;
}) {
  const bottom = useCoveringBottomInset();
  const groups = useMemo(() => optionGroupsFor(item.id, item.category), [item.id, item.category]);
  const [sizeSlug, setSizeSlug] = useState(() => defaultSizeSlug(item.durations));
  const [selection, setSelection] = useState<OptionSelection>(() => defaultOptionSelection(groups));
  const [quantity, setQuantity] = useState(1);
  const [showRequired, setShowRequired] = useState(false);

  const size = item.durations.find((entry) => entry.slug === sizeSlug) ?? item.durations[0];
  const basePriceCents = size ? sizePriceCents(size) : 0;
  const unitPriceCents = basePriceCents + optionDeltaCents(groups, selection);
  const missing = missingRequiredGroups(groups, selection);
  const visible = visibleOptionGroups(groups, selection);

  const sizes = item.durations.map((entry) => ({
    slug: entry.slug,
    label: sizeLabelFor(entry.slug),
    priceCents: sizePriceCents(entry),
  }));

  function add() {
    if (missing.length > 0) {
      setShowRequired(true);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => undefined);
      return;
    }
    if (!size) return;
    onAdd(buildOrderLine({
      itemId: item.id,
      name: item.name,
      sizeSlug: size.slug,
      sizeLabel: sizeLabelFor(size.slug),
      basePriceCents,
      groups,
      selection,
      quantity,
    }));
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
          <Image source={item.image} style={styles.heroImage} contentFit="cover" alt="" />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Close ${item.name}`}
            hitSlop={8}
            onPress={onClose}
            style={({ pressed }) => [styles.close, pressed && styles.pressed]}
          >
            <AppIcon name="xmark" size={17} tintColor={colors.ink900} weight="bold" />
          </Pressable>
        </View>

        <View style={styles.copy}>
          <Text accessibilityRole="header" style={styles.name}>{item.name}</Text>
          <Text style={styles.description}>{item.description}</Text>
        </View>

        {sizes.length > 1 ? (
          <View style={styles.block}>
            <Text style={styles.blockTitle}>Size</Text>
            <SizeSegmented sizes={sizes} value={sizeSlug} onChange={setSizeSlug} />
          </View>
        ) : null}

        {visible.map((group) => (
          <View key={group.id} style={styles.block}>
            <OptionGroupField
              group={group}
              selection={selection}
              onToggle={(groupId, choiceId) => {
                setShowRequired(false);
                setSelection((current) => toggleOptionChoice(groups, current, groupId, choiceId));
              }}
            />
          </View>
        ))}

        <View style={[styles.block, styles.quantityBlock]}>
          <Text style={styles.blockTitle}>Quantity</Text>
          <QuantityStepper
            quantity={quantity}
            max={MAX_LINE_QUANTITY}
            itemLabel={item.name}
            onDecrease={() => setQuantity((current) => Math.max(1, current - 1))}
            onIncrease={() => setQuantity((current) => Math.min(MAX_LINE_QUANTITY, current + 1))}
          />
        </View>

        {showRequired && missing.length > 0 ? (
          <Text accessibilityRole="alert" style={styles.error}>
            Choose {missing.map((group) => group.name.toLowerCase()).join(' and ')} first.
          </Text>
        ) : null}
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: bottom + spacing.sm }]}>
        <ActionButton
          label={quantity > 1 ? `Add ${quantity} to Bag` : 'Add to Bag'}
          value={formatMoney(unitPriceCents * quantity)}
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

const styles = StyleSheet.create({
  sheet: {
    maxHeight: '94%',
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  body: { flexShrink: 1 },
  scroll: { paddingBottom: spacing.lg, gap: spacing.lg },
  pressed: { opacity: 0.72 },

  hero: { height: 260, backgroundColor: colors.brand100 },
  heroImage: { width: '100%', height: '100%' },
  close: {
    position: 'absolute',
    top: spacing.md,
    left: spacing.md,
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },

  copy: { paddingHorizontal: spacing.lg, gap: spacing.xs },
  name: { color: colors.ink900, fontFamily: fonts.display, fontSize: 28, lineHeight: 34 },
  description: { color: colors.ink700, fontFamily: fonts.sans, fontSize: 15, lineHeight: 22 },

  block: { paddingHorizontal: spacing.lg, gap: spacing.sm },
  blockTitle: { color: colors.ink900, fontFamily: fonts.sansBold, fontSize: 18 },
  quantityBlock: { gap: spacing.sm },

  error: { paddingHorizontal: spacing.lg, color: colors.danger, fontFamily: fonts.sansMedium, fontSize: 13 },

  footer: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.ink200,
    backgroundColor: colors.surface,
  },
});
