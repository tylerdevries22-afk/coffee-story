import { ActionSheetIOS, Alert, Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, fonts, radius, spacing } from '@/theme/tokens';
import type { NativePickerOption } from '@/features/dates';

/**
 * A small native selector for values that already come from availability.
 * iOS uses its system action sheet; Android gets the equivalent native alert
 * action list. The web booking surface uses native HTML controls instead.
 */
export function NativeOptionPicker({
  label,
  value,
  options,
  onChange,
  disabled = false,
}: {
  label: string;
  value: string;
  options: readonly NativePickerOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const selected = options.find((option) => option.value === value);

  function open() {
    if (disabled || options.length === 0) return;
    const cancelButtonIndex = options.length;
    const choose = (index: number) => {
      if (index >= 0 && index < options.length) onChange(options[index].value);
    };
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        { title: label, options: [...options.map((option) => option.label), 'Cancel'], cancelButtonIndex },
        choose,
      );
      return;
    }
    Alert.alert(label, undefined, [
      ...options.map((option) => ({ text: option.label, onPress: () => onChange(option.value) })),
      { text: 'Cancel', style: 'cancel' },
    ]);
  }

  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${selected?.label ?? 'Choose'}`}
        accessibilityState={{ disabled }}
        disabled={disabled}
        onPress={open}
        style={({ pressed }) => [styles.control, disabled && styles.disabled, pressed && styles.pressed]}
      >
        <Text style={[styles.value, !selected && styles.placeholder]}>{selected?.label ?? 'Choose'}</Text>
        <Text aria-hidden style={styles.chevron}>⌄</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  field: { gap: spacing.xs },
  label: { color: colors.ink700, fontFamily: fonts.sansBold, fontSize: 12 },
  control: { minHeight: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderRadius: radius.md, borderWidth: 1, borderColor: colors.ink300, paddingHorizontal: spacing.md, backgroundColor: colors.white },
  value: { color: colors.ink900, fontFamily: fonts.sans, fontSize: 16 },
  placeholder: { color: colors.ink400 },
  chevron: { color: colors.ink500, fontSize: 20, lineHeight: 20 },
  disabled: { opacity: 0.5 },
  pressed: { opacity: 0.72 },
});
