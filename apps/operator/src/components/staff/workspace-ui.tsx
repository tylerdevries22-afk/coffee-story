import type { ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Card } from '@/components/ui';
import { deltaPercent, formatMoney, initials } from '@/features/staff/workspace';
import { colors, fonts, radius, spacing } from '@/theme/tokens';
import type { PortalAppointment } from '@/types/domain';
import { AppIcon } from '@/components/icon';
import { toggleState } from '@/lib/a11y-state';

/** Status → pill colour, matching the web portal's badge tones. */
const STATUS_TONE: Record<PortalAppointment['status'], { fg: string; bg: string }> = {
  confirmed: { fg: colors.success, bg: '#E4F0EA' },
  pending: { fg: colors.warning, bg: colors.gold50 },
  completed: { fg: colors.brand600, bg: colors.brand50 },
  cancelled: { fg: colors.ink500, bg: colors.ink200 },
  no_show: { fg: colors.danger, bg: '#F6E3E5' },
};

export function StatusBadge({ status }: { status: PortalAppointment['status'] }) {
  const tone = STATUS_TONE[status];
  return (
    <View style={[styles.badge, { backgroundColor: tone.bg }]}>
      <Text style={[styles.badgeText, { color: tone.fg }]}>{status.replace('_', ' ')}</Text>
    </View>
  );
}

export function SourceBadge({ label, tone = 'plum' }: { label: string; tone?: 'plum' | 'amber' | 'green' | 'gray' }) {
  const palette = {
    plum: { fg: colors.brand600, bg: colors.brand50 },
    amber: { fg: colors.warning, bg: colors.gold50 },
    green: { fg: colors.success, bg: '#E4F0EA' },
    gray: { fg: colors.ink500, bg: colors.warm },
  }[tone];
  return (
    <View style={[styles.badge, { backgroundColor: palette.bg }]}>
      <Text style={[styles.badgeText, { color: palette.fg }]}>{label}</Text>
    </View>
  );
}

export function Avatar({ name, size = 44, tone = 'soft' }: { name: string; size?: number; tone?: 'soft' | 'gold' }) {
  return (
    <View
      style={[
        styles.avatar,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: tone === 'gold' ? colors.gold400 : colors.brand100,
        },
      ]}
    >
      <Text style={[styles.avatarText, { fontSize: size * 0.34, color: tone === 'gold' ? colors.ink900 : colors.brand700 }]}>
        {initials(name)}
      </Text>
    </View>
  );
}

/**
 * Headline figure with an optional period-over-period delta, mirroring the
 * web dashboard's KPI row. The delta chip is dropped entirely when there is no
 * usable baseline rather than showing a misleading 0%.
 */
export function StatTile({
  label,
  value,
  previous,
  current,
  hint,
}: {
  label: string;
  value: string;
  current?: number;
  previous?: number;
  hint?: string;
}) {
  const delta = current === undefined ? null : deltaPercent(current, previous);
  return (
    <View style={styles.statTile}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue}>{value}</Text>
      <View style={styles.statFooter}>
        {delta === null ? null : (
          <Text style={[styles.statDelta, { color: delta >= 0 ? colors.success : colors.danger }]}>
            {delta >= 0 ? '▲' : '▼'} {Math.abs(delta)}%
          </Text>
        )}
        {hint ? <Text style={styles.statHint}>{hint}</Text> : null}
      </View>
    </View>
  );
}

export function WorkspaceCard({
  title,
  action,
  onAction,
  children,
  style,
}: {
  title: string;
  action?: string;
  onAction?: () => void;
  children: ReactNode;
  style?: object;
}) {
  return (
    <Card style={{ ...styles.card, ...(style ?? {}) }}>
      <View style={styles.cardHeader}>
        <Text style={styles.cardTitle}>{title}</Text>
        {action ? (
          <Pressable accessibilityRole="button" onPress={onAction} hitSlop={8}>
            <Text style={styles.cardAction}>{action}</Text>
          </Pressable>
        ) : null}
      </View>
      {children}
    </Card>
  );
}

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
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.chipRow}
    >
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

export function Chip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
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
      <AppIcon name={symbol} size={16} tintColor={colors.brand700} />
    </Pressable>
  );
}

/** Muted rule used between agenda rows to show buffer or open time. */
export function GapStrip({ kind, minutes }: { kind: 'recovery' | 'open'; minutes: number }) {
  if (kind === 'recovery') {
    return (
      <View style={styles.recoveryStrip}>
        <AppIcon name="clock" size={13} tintColor={colors.brand500} />
        <Text style={styles.recoveryText}>{minutes} min recovery &amp; room reset</Text>
      </View>
    );
  }
  return <Text style={styles.openGapText}>{minutes} min open</Text>;
}

export function MoneyText({ cents, style }: { cents: number; style?: object }) {
  return <Text style={{ ...styles.money, ...(style ?? {}) }}>{formatMoney(cents)}</Text>;
}

export function EmptyState({ title, message }: { title: string; message: string }) {
  return (
    <Card style={styles.empty}>
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyMessage}>{message}</Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  badge: { borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 4, alignSelf: 'flex-start' },
  badgeText: { fontFamily: fonts.sansBold, fontSize: 11, letterSpacing: 0.2 },
  avatar: { alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontFamily: fonts.sansBold },
  statTile: {
    flexGrow: 1,
    flexBasis: '46%',
    minHeight: 96,
    borderRadius: radius.md,
    backgroundColor: colors.brand50,
    padding: spacing.md,
    gap: 2,
    justifyContent: 'center',
  },
  statLabel: { color: colors.ink500, fontFamily: fonts.sansMedium, fontSize: 12 },
  statValue: { color: colors.ink900, fontFamily: fonts.display, fontSize: 26 },
  statFooter: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  statDelta: { fontFamily: fonts.sansBold, fontSize: 11 },
  statHint: { color: colors.ink400, fontFamily: fonts.sans, fontSize: 11, flexShrink: 1 },
  card: { gap: spacing.sm },
  cardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  cardTitle: { color: colors.ink900, fontFamily: fonts.sansBold, fontSize: 17, flexShrink: 1 },
  cardAction: { color: colors.brand600, fontFamily: fonts.sansMedium, fontSize: 13 },
  chipRow: { gap: spacing.xs, paddingRight: spacing.md },
  chip: {
    minHeight: 38,
    justifyContent: 'center',
    borderRadius: radius.pill,
    backgroundColor: colors.warm,
    paddingHorizontal: spacing.md,
  },
  chipSelected: { backgroundColor: colors.brand600 },
  chipText: { color: colors.ink700, fontFamily: fonts.sansMedium, fontSize: 14 },
  chipTextSelected: { color: colors.white },
  switcher: {
    flexDirection: 'row',
    borderRadius: radius.pill,
    backgroundColor: colors.warm,
    padding: 4,
    gap: 2,
  },
  switcherItem: { flex: 1, minHeight: 38, alignItems: 'center', justifyContent: 'center', borderRadius: radius.pill },
  switcherItemActive: { backgroundColor: colors.brand600 },
  switcherText: { color: colors.ink700, fontFamily: fonts.sansMedium, fontSize: 14 },
  switcherTextActive: { color: colors.white, fontFamily: fonts.sansBold },
  iconButton: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  iconButtonSoft: { backgroundColor: colors.brand50 },
  recoveryStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    borderRadius: radius.pill,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.brand200,
    paddingHorizontal: spacing.sm,
    paddingVertical: 5,
  },
  recoveryText: { color: colors.brand600, fontFamily: fonts.sansMedium, fontSize: 12 },
  openGapText: { color: colors.ink400, fontFamily: fonts.sans, fontSize: 12, paddingVertical: 2 },
  money: { color: colors.ink900, fontFamily: fonts.sansBold, fontSize: 15 },
  empty: { alignItems: 'center', gap: 6, paddingVertical: spacing.xl },
  emptyTitle: { color: colors.ink900, fontFamily: fonts.sansBold, fontSize: 16 },
  emptyMessage: { color: colors.ink500, fontFamily: fonts.sans, fontSize: 14, textAlign: 'center' },
  pressed: { opacity: 0.75 },
});
