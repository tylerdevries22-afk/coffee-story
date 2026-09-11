import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import {
  AppIcon,
  toggleState,
  useTokens as useBrandTokens,
  type BrandTokens,
} from '@platform/ui';

/** Horizontal chip strip; spreads the swipe exclusion so it never pages tabs. */
export function ChipRow<T extends string>({
  options,
  value,
  onChange,
  allLabel,
}: {
  options: readonly T[];
  value: T | null;
  onChange: (next: T | null) => void;
  allLabel?: string;
}) {
  const styles = createStyles(useBrandTokens());
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
      {allLabel ? (
        <Chip label={allLabel} selected={value === null} onPress={() => onChange(null)} />
      ) : null}
      {options.map((option) => (
        <Chip
          key={option}
          label={option}
          selected={value === option}
          onPress={() => onChange(value === option ? null : option)}
        />
      ))}
    </ScrollView>
  );
}

export function Chip({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  const styles = createStyles(useBrandTokens());
  return (
    <Pressable
      accessibilityRole="button"
      {...toggleState(selected)}
      onPress={onPress}
      style={({ pressed }) => [styles.chip, selected && styles.chipSelected, pressed && styles.pressed]}
    >
      <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{label}</Text>
    </Pressable>
  );
}

/** Segmented control sized for four options, used by the calendar switcher. */
export function ViewSwitcher<T extends string>({
  options,
  value,
  onChange,
}: {
  options: readonly T[];
  value: T;
  onChange: (next: T) => void;
}) {
  const styles = createStyles(useBrandTokens());
  return (
    <View style={styles.switcher}>
      {options.map((option) => (
        <Pressable
          key={option}
          accessibilityRole="button"
          {...toggleState(option === value)}
          onPress={() => onChange(option)}
          style={({ pressed }) => [
            styles.switcherItem,
            option === value && styles.switcherItemActive,
            pressed && styles.pressed,
          ]}
        >
          <Text style={[styles.switcherText, option === value && styles.switcherTextActive]}>{option}</Text>
        </Pressable>
      ))}
    </View>
  );
}

export function IconButton({
  label,
  symbol,
  onPress,
  tone = 'soft',
}: {
  label: string;
  symbol: 'chevron.left' | 'chevron.right' | 'magnifyingglass' | 'plus' | 'xmark';
  onPress: () => void;
  tone?: 'soft' | 'plain';
}) {
  const tokens = useBrandTokens();
  const styles = createStyles(tokens);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [
        styles.iconButton,
        tone === 'soft' && styles.iconButtonSoft,
        pressed && styles.pressed,
      ]}
    >
      <AppIcon name={symbol} size={16} tintColor={tokens.primary} />
    </Pressable>
  );
}

const createStyles = (tokens: BrandTokens) => StyleSheet.create({
  chipRow: { gap: tokens.spacing.sm, paddingRight: tokens.spacing.lg },
  chip: {
    minHeight: 38,
    justifyContent: 'center',
    borderRadius: tokens.radius.pill,
    backgroundColor: tokens.surface,
    paddingHorizontal: tokens.spacing.lg,
  },
  chipSelected: { backgroundColor: tokens.primary },
  chipText: { color: tokens.textPrimary, fontFamily: tokens.fontBody, fontSize: 14 },
  chipTextSelected: { color: tokens.surfaceElevated },
  switcher: {
    flexDirection: 'row',
    borderRadius: tokens.radius.pill,
    backgroundColor: tokens.surface,
    padding: 4,
    gap: 2,
  },
  switcherItem: {
    flex: 1,
    minHeight: 38,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: tokens.radius.pill,
  },
  switcherItemActive: { backgroundColor: tokens.primary },
  switcherText: { color: tokens.textPrimary, fontFamily: tokens.fontBody, fontSize: 14 },
  switcherTextActive: { color: tokens.surfaceElevated, fontFamily: tokens.fontBody },
  iconButton: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  iconButtonSoft: { backgroundColor: tokens.surface },
  pressed: { opacity: 0.75 },
});
