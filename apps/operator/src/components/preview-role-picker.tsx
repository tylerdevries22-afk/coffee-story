import { Pressable, StyleSheet, Text, View } from 'react-native';

import { choiceState } from '@/lib/a11y-state';
import { colors, fonts, radius, spacing } from '@/theme/tokens';
import type { AppRole } from '@platform/domain';

const ROLES: readonly AppRole[] = ['client', 'staff', 'admin'];

/**
 * The demo-only switch between the client, staff and admin personas.
 *
 * Styled after the native `UISegmentedControl` — the same vocabulary the
 * bottom tab bar speaks: a translucent gray well, a white selected capsule
 * with a soft shadow, and system-weight labels. The previous plum/gold slider
 * animated between segments and, worse, stayed hidden until `onLayout`
 * delivered a width, so every role swap flashed an unselected frame. The
 * selected capsule is now just the selected segment's own background: it
 * renders on the very first frame, switches instantly, and nothing measures
 * or animates. Native segmented controls crossfade rather than slide, so
 * dropping the thumb animation matches the platform too.
 */
export function PreviewRolePicker({
  role,
  onChange,
}: {
  role: AppRole;
  onChange: (role: AppRole) => void;
}) {
  return (
    <View style={styles.block}>
      <Text style={styles.caption}>Preview role</Text>
      <View accessibilityRole="radiogroup" accessibilityLabel="Preview role" style={styles.group}>
        {ROLES.map((option) => {
          const selected = option === role;
          return (
            <Pressable
              key={option}
              accessibilityRole="radio"
              accessibilityLabel={option}
              {...choiceState(selected)}
              hitSlop={4}
              onPress={() => onChange(option)}
              style={({ pressed }) => [
                styles.option,
                selected && styles.optionSelected,
                pressed && !selected && styles.pressed,
              ]}
            >
              <Text style={[styles.label, selected && styles.selectedLabel]}>
                {option}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  block: {
    gap: spacing.xs,
  },
  caption: {
    paddingHorizontal: 4,
    color: colors.ink500,
    fontFamily: fonts.sansBold,
    fontSize: 10,
    letterSpacing: 1.1,
    textTransform: 'uppercase',
  },
  group: {
    minHeight: 44,
    padding: 3,
    flexDirection: 'row',
    borderRadius: radius.pill,
    // iOS's classic segmented-control well: system fill, no border.
    backgroundColor: 'rgba(120,120,128,0.16)',
  },
  option: {
    flex: 1,
    minHeight: 38,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
  },
  optionSelected: {
    backgroundColor: colors.white,
    shadowColor: colors.ink900,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.12,
    shadowRadius: 3,
    elevation: 2,
  },
  label: {
    color: colors.ink500,
    fontFamily: fonts.sansMedium,
    fontSize: 13,
    textTransform: 'capitalize',
  },
  selectedLabel: {
    color: colors.ink900,
    fontFamily: fonts.sansBold,
  },
  pressed: {
    opacity: 0.72,
  },
});
