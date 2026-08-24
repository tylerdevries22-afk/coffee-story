import { Pressable, StyleSheet, Text, View } from 'react-native';

import { AppIcon } from '@/components/icon';
import { setupProgressPercent, type AnyRoleSetup } from '@/features/setup/setup';
import { useTokens as useBrandTokens, type BrandTokens } from '@platform/ui';

export function SetupProgressCard({
  setup,
  onPress,
}: {
  setup: AnyRoleSetup;
  onPress: () => void;
}) {
  const tokens = useBrandTokens();
  const styles = createStyles(tokens);
  const percent = setupProgressPercent(setup);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Workspace setup, ${percent}% complete`}
      accessibilityValue={{ min: 0, max: 100, now: percent }}
      onPress={onPress}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
    >
      <AppIcon name="star" size={21} tintColor={tokens.primary} />
      <View style={styles.copy}>
        <Text style={styles.title}>Workspace setup</Text>
        <Text style={styles.detail}>Review or continue onboarding</Text>
      </View>
      <Text style={styles.percent}>{percent}%</Text>
      <AppIcon name="chevron.right" size={14} tintColor={tokens.textMuted} />
      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: `${percent}%` }]} />
      </View>
    </Pressable>
  );
}

const createStyles = (tokens: BrandTokens) => StyleSheet.create({
  card: {
    position: 'relative',
    minHeight: 68,
    overflow: 'hidden',
    flexDirection: 'row',
    alignItems: 'center',
    gap: tokens.spacing.md,
    paddingHorizontal: tokens.spacing.lg,
    paddingVertical: tokens.spacing.md,
    borderRadius: tokens.radius.lg,
    borderWidth: 1,
    borderColor: tokens.surface,
    backgroundColor: tokens.surfaceElevated,
  },
  copy: { flex: 1, gap: 2 },
  title: { color: tokens.textPrimary, fontFamily: tokens.fontBody, fontSize: 15 },
  detail: { color: tokens.textMuted, fontFamily: tokens.fontBody, fontSize: 11 },
  percent: { color: tokens.primary, fontFamily: tokens.fontBody, fontSize: 12 },
  progressTrack: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 3, backgroundColor: tokens.surface },
  progressFill: { height: 3, borderRadius: tokens.radius.pill, backgroundColor: tokens.primary },
  pressed: { opacity: 0.75, transform: [{ scale: 0.99 }] },
});
