import { Pressable, StyleSheet, Text, View } from 'react-native';

import { AppIcon } from '@/components/icon';
import { ProfileAvatar } from '@/components/profile-avatar';
import { useTokens as useBrandTokens, type BrandTokens } from '@platform/ui';

export type ProfileMetric = {
  label: string;
  value: string;
};

type PortalProfileCardProps = {
  name: string;
  avatarUrl: string | null;
  roleLabel: string;
  previewLabel: string;
  metrics: readonly ProfileMetric[];
  onProfile: () => void;
  profileLabel: string;
  onSettings?: () => void;
  settingsLabel?: string;
};

/** Shared identity-and-metrics layout for client, staff, and owner portals. */
export function PortalProfileCard({
  name,
  avatarUrl,
  roleLabel,
  previewLabel,
  metrics,
  onProfile,
  profileLabel,
  onSettings,
  settingsLabel = 'Open settings',
}: PortalProfileCardProps) {
  const tokens = useBrandTokens();
  const styles = createStyles(tokens);
  const identity = (
    <>
      <ProfileAvatar name={name} avatarUrl={avatarUrl} editable onEdit={onProfile} />
      <View style={styles.identityCopy}>
        <Text numberOfLines={1} style={styles.identityName}>{name}</Text>
        <View style={styles.identityMeta}>
          <View style={styles.statusDot} />
          <Text style={styles.identityRole}>{roleLabel}</Text>
          <Text style={styles.identityPreview}>{previewLabel}</Text>
        </View>
      </View>
    </>
  );

  const content = (
    <>
      <View style={styles.headerTop}>
        {onSettings ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={profileLabel}
            onPress={onProfile}
            style={({ pressed }) => [styles.identity, pressed && styles.pressed]}
          >
            {identity}
          </Pressable>
        ) : (
          <View style={styles.identity}>{identity}</View>
        )}
        {/* Minimal diagonal arrow into the account surface — the bordered gear
            circle read as chrome the card didn't need. No border, no well. */}
        {onSettings ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={settingsLabel}
            hitSlop={10}
            onPress={onSettings}
            style={({ pressed }) => [pressed && styles.pressed]}
          >
            <AppIcon name="arrow.up.right" size={18} tintColor={tokens.textMuted} />
          </Pressable>
        ) : (
          <AppIcon name="arrow.up.right" size={18} tintColor={tokens.textMuted} />
        )}
      </View>
      <View style={styles.metrics}>
        {metrics.map((metric) => (
          <View key={metric.label} style={styles.metric}>
            <Text numberOfLines={1} adjustsFontSizeToFit style={styles.metricValue}>{metric.value}</Text>
            <Text numberOfLines={1} adjustsFontSizeToFit style={styles.metricLabel}>{metric.label}</Text>
          </View>
        ))}
      </View>
    </>
  );

  if (!onSettings) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={profileLabel}
        onPress={onProfile}
        style={({ pressed }) => [styles.card, pressed && styles.pressed]}
      >
        {content}
      </Pressable>
    );
  }

  return <View style={styles.card}>{content}</View>;
}

const createStyles = (tokens: BrandTokens) => StyleSheet.create({
  // Same tinted-pill language as the PillRow menu items below it: brand50
  // ground, brand100 hairline, no shadow — the card reads as the first row of
  // the page rather than a separate white panel floating on it.
  card: {
    gap: tokens.spacing.lg,
    padding: tokens.spacing.lg,
    paddingHorizontal: tokens.spacing.xl,
    borderRadius: tokens.radius.lg,
    borderWidth: 1,
    borderColor: tokens.surface,
    backgroundColor: tokens.surface,
  },
  headerTop: { flexDirection: 'row', alignItems: 'center', gap: tokens.spacing.md, minHeight: 54 },
  identity: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: tokens.spacing.md, minHeight: 54 },
  identityCopy: { flex: 1, minWidth: 0 },
  identityName: { color: tokens.textPrimary, fontFamily: tokens.fontDisplay, fontSize: 17 },
  identityMeta: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 3 },
  statusDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: tokens.success },
  identityRole: { color: tokens.textPrimary, fontFamily: tokens.fontBody, fontSize: 10 },
  identityPreview: { color: tokens.textMuted, fontFamily: tokens.fontBody, fontSize: 11, textTransform: 'capitalize' },
  metrics: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: tokens.surface, paddingTop: tokens.spacing.md },
  metric: { flex: 1, alignItems: 'center', paddingHorizontal: 2 },
  metricValue: { color: tokens.textPrimary, fontFamily: tokens.fontDisplay, fontSize: 15 },
  metricLabel: { color: tokens.textMuted, fontFamily: tokens.fontBody, fontSize: 9, letterSpacing: 0.45, textTransform: 'uppercase', marginTop: 3 },
  pressed: { opacity: 0.76, transform: [{ scale: 0.99 }] },
});
