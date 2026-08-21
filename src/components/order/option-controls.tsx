/**
 * The controls an item detail screen is built from: the size track, the
 * required radio groups, the optional add-in checkboxes, and the quantity
 * stepper.
 *
 * These were written out inline four times across `order-screen.tsx`,
 * `book-screen.tsx` and the staff `cart-section.tsx`, each with slightly
 * different rings, hit targets and accessibility labels. One copy here means
 * the price is announced with the choice everywhere, which is the part the
 * inline versions kept dropping.
 */
import * as Haptics from 'expo-haptics';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { Pressable } from 'react-native';

import { AppIcon } from '@/components/icon';
import { formatMoney, formatPriceDelta } from '@/features/money';
import type { OptionChoice, OptionGroup, OptionSelection } from '@/features/order/menu-options';
import { choiceState, disabledState } from '@/lib/a11y-state';
import { colors, fonts, radius, shadow, spacing } from '@/theme/tokens';

function tap() {
  void Haptics.selectionAsync().catch(() => undefined);
}

export type SizeOption = {
  slug: string;
  label: string;
  priceCents: number;
};

/**
 * The 12oz / 16oz / 20oz track.
 *
 * A radio group rather than a tab list: picking a size changes what is being
 * bought, it does not change which panel is showing. `ui.tsx`'s `Segmented` is
 * the tab-list one and stays where it is.
 */
export function SizeSegmented({
  sizes,
  value,
  onChange,
}: {
  sizes: readonly SizeOption[];
  value: string;
  onChange: (slug: string) => void;
}) {
  if (sizes.length < 2) return null;
  return (
    <View accessibilityRole="radiogroup" style={styles.sizeTrack}>
      {sizes.map((size) => {
        const selected = size.slug === value;
        return (
          <Pressable
            key={size.slug}
            accessibilityRole="radio"
            accessibilityLabel={`${size.label}, ${formatMoney(size.priceCents)}`}
            {...choiceState(selected)}
            onPress={() => {
              if (!selected) tap();
              onChange(size.slug);
            }}
            style={({ pressed }) => [
              styles.sizeOption,
              selected && styles.sizeOptionSelected,
              pressed && styles.pressed,
            ]}
          >
            <Text style={[styles.sizeLabel, selected && styles.sizeLabelSelected]}>{size.label}</Text>
            <Text style={[styles.sizePrice, selected && styles.sizePriceSelected]}>
              {formatMoney(size.priceCents)}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/**
 * One option group, rendered as radios or checkboxes according to its own
 * `select` field. The "Required" caption is the group's, not the row's, which
 * is what lets the Add to Bag button explain itself by naming the group.
 */
export function OptionGroupField({
  group,
  selection,
  onToggle,
}: {
  group: OptionGroup;
  selection: OptionSelection;
  onToggle: (groupId: string, choiceId: string) => void;
}) {
  const chosen = selection[group.id] ?? [];
  const atLimit = group.select === 'multi' && chosen.length >= group.maxChoices;
  return (
    <View style={styles.group}>
      <View style={styles.groupHeader}>
        <Text style={styles.groupTitle}>{group.name}</Text>
        <Text style={styles.groupCaption}>
          {group.required
            ? 'Required'
            : group.select === 'multi'
              ? `Optional · choose up to ${group.maxChoices}`
              : 'Optional'}
        </Text>
      </View>
      <View
        accessibilityRole={group.select === 'single' ? 'radiogroup' : undefined}
        style={styles.groupRows}
      >
        {group.choices.map((choice) => (
          <OptionRow
            key={choice.id}
            choice={choice}
            select={group.select}
            checked={chosen.includes(choice.id)}
            // A full multi-select group greys out what would be a no-op tap
            // rather than swallowing it silently.
            disabled={atLimit && !chosen.includes(choice.id)}
            onPress={() => {
              tap();
              onToggle(group.id, choice.id);
            }}
          />
        ))}
      </View>
    </View>
  );
}

function OptionRow({
  choice,
  select,
  checked,
  disabled,
  onPress,
}: {
  choice: OptionChoice;
  select: OptionGroup['select'];
  checked: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  const delta = formatPriceDelta(choice.priceDeltaCents);
  return (
    <Pressable
      accessibilityRole={select === 'single' ? 'radio' : 'checkbox'}
      // The price belongs in the label: a screen reader that reads only the
      // name gives no way to tell a free choice from a paid one.
      accessibilityLabel={delta ? `${choice.name}, ${delta.replace('+', 'plus ')}` : choice.name}
      {...choiceState(checked)}
      {...disabledState(disabled)}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.optionRow,
        pressed && styles.pressed,
        disabled && styles.optionRowDisabled,
      ]}
    >
      {select === 'single' ? (
        <View style={[styles.radio, checked && styles.radioSelected]} />
      ) : (
        <View style={[styles.checkbox, checked && styles.checkboxSelected]}>
          {checked ? <AppIcon name="checkmark" size={13} tintColor={colors.white} weight="bold" /> : null}
        </View>
      )}
      <Text style={[styles.optionName, checked && styles.optionNameChecked]}>{choice.name}</Text>
      {delta ? <Text style={styles.optionDelta}>{delta}</Text> : null}
    </Pressable>
  );
}

/**
 * The bag's minus / count / plus control.
 *
 * At one, the minus becomes a bin: the reference flow removes a line from the
 * same spot it decrements it, and a stepper that stops dead at 1 leaves no way
 * to take an item out without hunting for a second control.
 */
export function QuantityStepper({
  quantity,
  max,
  itemLabel,
  onDecrease,
  onIncrease,
  style,
}: {
  quantity: number;
  max: number;
  /** Named in every button label, so the buttons are distinguishable. */
  itemLabel: string;
  onDecrease: () => void;
  onIncrease: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  const removes = quantity <= 1;
  const atMax = quantity >= max;
  return (
    <View style={[styles.stepper, style]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={removes ? `Remove ${itemLabel}` : `One fewer ${itemLabel}`}
        hitSlop={6}
        onPress={() => {
          tap();
          onDecrease();
        }}
        style={({ pressed }) => [styles.stepperButton, pressed && styles.pressed]}
      >
        <AppIcon name={removes ? 'trash' : 'minus'} size={16} tintColor={colors.ink900} />
      </Pressable>
      <Text accessibilityLabel={`Quantity ${quantity}`} style={styles.stepperCount}>{quantity}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`One more ${itemLabel}`}
        hitSlop={6}
        disabled={atMax}
        {...disabledState(atMax)}
        onPress={() => {
          tap();
          onIncrease();
        }}
        style={({ pressed }) => [
          styles.stepperButton,
          pressed && styles.pressed,
          atMax && styles.stepperButtonDisabled,
        ]}
      >
        <AppIcon name="plus" size={16} tintColor={colors.ink900} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  pressed: { opacity: 0.72 },

  sizeTrack: {
    flexDirection: 'row',
    gap: spacing.xs,
    padding: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.brand100,
  },
  sizeOption: {
    flex: 1,
    minHeight: 56,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 1,
    paddingHorizontal: spacing.xs,
  },
  sizeOptionSelected: { backgroundColor: colors.white, ...shadow.card, shadowOpacity: 0.06 },
  sizeLabel: { color: colors.ink700, fontFamily: fonts.sansMedium, fontSize: 15 },
  sizeLabelSelected: { color: colors.ink900, fontFamily: fonts.sansBold },
  sizePrice: { color: colors.ink600, fontFamily: fonts.sans, fontSize: 12 },
  sizePriceSelected: { color: colors.brand700, fontFamily: fonts.sansMedium },

  group: { gap: spacing.sm },
  groupHeader: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: spacing.sm },
  groupTitle: { color: colors.ink900, fontFamily: fonts.sansBold, fontSize: 18 },
  groupCaption: { color: colors.ink600, fontFamily: fonts.sans, fontSize: 12 },
  groupRows: { borderRadius: radius.md, overflow: 'hidden', backgroundColor: colors.white },

  optionRow: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.ink200,
  },
  optionRowDisabled: { opacity: 0.42 },
  optionName: { flex: 1, color: colors.ink900, fontFamily: fonts.sans, fontSize: 15 },
  optionNameChecked: { fontFamily: fonts.sansMedium },
  optionDelta: { color: colors.ink600, fontFamily: fonts.sansMedium, fontSize: 13 },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: colors.ink300 },
  radioSelected: { borderWidth: 7, borderColor: colors.brand700 },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 7,
    borderWidth: 2,
    borderColor: colors.ink300,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxSelected: { backgroundColor: colors.brand700, borderColor: colors.brand700 },

  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    borderRadius: radius.pill,
    backgroundColor: colors.brand50,
    borderWidth: 1,
    borderColor: colors.brand100,
  },
  stepperButton: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  stepperButtonDisabled: { opacity: 0.35 },
  stepperCount: { minWidth: 28, textAlign: 'center', color: colors.ink900, fontFamily: fonts.sansBold, fontSize: 16 },
});
