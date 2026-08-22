import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Eyebrow } from '@/components/ui';
import { colors, fonts, spacing } from '@/theme/tokens';
import { AppIcon, type AppIconName } from '@/components/icon';
import { toggleState } from '@/lib/a11y-state';

type SymbolName = AppIconName;

/**
 * Shared header for the three More pages (client, staff, owner).
 *
 * They deliberately carry no "More" title: the bottom tab already names the
 * page, so the eyebrow alone identifies the persona and the content starts
 * immediately. Actions sit on the trailing edge of that same row. Keeping this
 * in one component is what holds the three pages to one layout.
 */
export function MorePageHeader({
  eyebrow,
  actions,
  leading,
}: {
  eyebrow: string;
  actions?: ReactNode;
  /** Replaces the eyebrow, for headers that need a control rather than a label. */
  leading?: ReactNode;
}) {
  return (
    <View style={styles.header}>
      {leading ?? <Eyebrow>{eyebrow}</Eyebrow>}
      {actions ? <View style={styles.actions}>{actions}</View> : null}
    </View>
  );
}

/**
 * Round icon button for the header's action slot. Shared by all three More
 * pages. The white/plum outline is intentionally identical on every portal.
 */
export function HeaderIconButton({
  label,
  symbol,
  selected = false,
  badge,
  onPress,
}: {
  label: string;
  symbol: SymbolName;
  selected?: boolean;
  /** Unread count; hidden at zero and capped at 9, as the web bell does. */
  badge?: number;
  onPress: () => void;
}) {
  const button = (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={badge ? `${label}, ${badge} unread` : label}
      {...toggleState(selected)}
      onPress={onPress}
      style={({ pressed }) => [
        styles.iconButton,
        selected && styles.iconButtonSelected,
        pressed && styles.pressed,
      ]}
    >
      <AppIcon name={symbol} size={20} tintColor={colors.brand700} />
    </Pressable>
  );
  if (!badge) return button;
  return (
    <View>
      {button}
      <View style={styles.badge}>
        <Text style={styles.badgeText}>{Math.min(badge, 9)}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    minHeight: 46,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  actions: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexShrink: 1 },
  iconButton: { width: 46, height: 46, borderRadius: 23, borderWidth: 1, borderColor: colors.brand200, backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center' },
  iconButtonSelected: { borderColor: colors.brand400, backgroundColor: colors.brand50 },
  badge: {
    position: 'absolute',
    top: -3,
    right: -2,
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.danger,
    borderWidth: 2,
    borderColor: colors.white,
  },
  badgeText: { color: colors.white, fontFamily: fonts.sansBold, fontSize: 10 },
  pressed: { opacity: 0.75 },
});
