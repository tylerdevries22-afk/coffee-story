import { Pressable, StyleSheet, Text, View } from 'react-native';

import { AppIcon } from '@/components/icon';
import { setupProgressPercent, type AnyRoleSetup } from '@/features/setup/setup';
import { colors, fonts, radius, spacing } from '@/theme/tokens';

export function SetupProgressCard({
  setup,
  onPress,
}: {
  setup: AnyRoleSetup;
  onPress: () => void;
}) {
  const percent = setupProgressPercent(setup);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Workspace setup, ${percent}% complete`}
      accessibilityValue={{ min: 0, max: 100, now: percent }}
      onPress={onPress}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
    >
      <AppIcon name="star" size={21} tintColor={colors.brand700} />
      <View style={styles.copy}>
        <Text style={styles.title}>Workspace setup</Text>
        <Text style={styles.detail}>Review or continue onboarding</Text>
      </View>
      <Text style={styles.percent}>{percent}%</Text>
      <AppIcon name="chevron.right" size={14} tintColor={colors.ink400} />
      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: `${percent}%` }]} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    position: 'relative',
    minHeight: 68,
    overflow: 'hidden',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.brand100,
    backgroundColor: colors.white,
  },
  copy: { flex: 1, gap: 2 },
  title: { color: colors.ink900, fontFamily: fonts.sansBold, fontSize: 15 },
  detail: { color: colors.ink500, fontFamily: fonts.sans, fontSize: 11 },
  percent: { color: colors.brand700, fontFamily: fonts.sansBold, fontSize: 12 },
  progressTrack: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 3, backgroundColor: colors.brand100 },
  progressFill: { height: 3, borderRadius: radius.pill, backgroundColor: colors.brand600 },
  pressed: { opacity: 0.75, transform: [{ scale: 0.99 }] },
});
