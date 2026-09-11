import { StyleSheet, Text, View } from 'react-native';

import { initials } from '@/features/staff/workspace';
import type { PortalOrder } from '@platform/domain';
import { useTokens as useBrandTokens, type BrandTokens } from '@platform/ui';

/** Every order state has an explicit pill tone. */
export function StatusBadge({ status }: { status: PortalOrder['status'] }) {
  const tokens = useBrandTokens();
  const styles = createStyles(tokens);
  const tones: Record<PortalOrder['status'], { fg: string; bg: string }> = {
    created: { fg: tokens.textMuted, bg: tokens.secondary },
    paid: { fg: tokens.success, bg: tokens.surfaceElevated },
    in_progress: { fg: tokens.warning, bg: tokens.surface },
    ready: { fg: tokens.primary, bg: tokens.surface },
    picked_up: { fg: tokens.textMuted, bg: tokens.secondary },
    cancelled: { fg: tokens.textMuted, bg: tokens.secondary },
    refunded: { fg: tokens.danger, bg: tokens.surfaceElevated },
  };
  const tone = tones[status];
  return (
    <View style={[styles.badge, { backgroundColor: tone.bg }]}>
      <Text style={[styles.badgeText, { color: tone.fg }]}>{status.replace('_', ' ')}</Text>
    </View>
  );
}

export function SourceBadge({
  label,
  tone = 'plum',
}: {
  label: string;
  tone?: 'plum' | 'amber' | 'green' | 'gray';
}) {
  const tokens = useBrandTokens();
  const styles = createStyles(tokens);
  const palette = {
    plum: { fg: tokens.primary, bg: tokens.surface },
    amber: { fg: tokens.warning, bg: tokens.surface },
    green: { fg: tokens.success, bg: tokens.surfaceElevated },
    gray: { fg: tokens.textMuted, bg: tokens.surface },
  }[tone];
  return (
    <View style={[styles.badge, { backgroundColor: palette.bg }]}>
      <Text style={[styles.badgeText, { color: palette.fg }]}>{label}</Text>
    </View>
  );
}

export function Avatar({
  name,
  size = 44,
  tone = 'soft',
}: {
  name: string;
  size?: number;
  tone?: 'soft' | 'gold';
}) {
  const tokens = useBrandTokens();
  const styles = createStyles(tokens);
  const gold = tone === 'gold';
  return (
    <View style={[styles.avatar, {
      width: size,
      height: size,
      borderRadius: size / 2,
      backgroundColor: gold ? tokens.accent : tokens.surface,
    }]}>
      <Text style={[styles.avatarText, {
        fontSize: size * 0.34,
        color: gold ? tokens.textPrimary : tokens.primary,
      }]}>
        {initials(name)}
      </Text>
    </View>
  );
}

const createStyles = (tokens: BrandTokens) => StyleSheet.create({
  badge: {
    borderRadius: tokens.radius.pill,
    paddingHorizontal: tokens.spacing.md,
    paddingVertical: 4,
    alignSelf: 'flex-start',
  },
  badgeText: { fontFamily: tokens.fontBody, fontSize: 11, letterSpacing: 0.2 },
  avatar: { alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontFamily: tokens.fontBody },
});
