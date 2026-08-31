import type { ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Card } from '@/components/ui';
import { deltaPercent, formatMoney, initials } from '@/features/staff/workspace';
import type { PortalOrder } from '@platform/domain';
import { toggleState, AppIcon } from '@platform/ui';
import { useTokens as useBrandTokens, type BrandTokens } from '@platform/ui';

/**
 * Status -> pill colour, one entry per state in rule 2's machine.
 *
 * Record<> rather than a partial map on purpose: adding a state to the enum
 * should fail this file rather than render an undefined tone at runtime.
 */
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

export function SourceBadge({ label, tone = 'plum' }: { label: string; tone?: 'plum' | 'amber' | 'green' | 'gray' }) {
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

export function Avatar({ name, size = 44, tone = 'soft' }: { name: string; size?: number; tone?: 'soft' | 'gold' }) {
  const tokens = useBrandTokens();
  const styles = createStyles(tokens);
  return (
    <View
      style={[
        styles.avatar,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: tone === 'gold' ? tokens.accent : tokens.surface,
        },
      ]}
    >
      <Text style={[styles.avatarText, { fontSize: size * 0.34, color: tone === 'gold' ? tokens.textPrimary : tokens.primary }]}>
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
  const tokens = useBrandTokens();
  const styles = createStyles(tokens);
  const delta = current === undefined ? null : deltaPercent(current, previous);
  return (
    <View style={styles.statTile}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue}>{value}</Text>
      <View style={styles.statFooter}>
        {delta === null ? null : (
          <Text style={[styles.statDelta, { color: delta >= 0 ? tokens.success : tokens.danger }]}>
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
  const tokens = useBrandTokens();
  const styles = createStyles(tokens);
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
  const tokens = useBrandTokens();
  const styles = createStyles(tokens);
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
  const tokens = useBrandTokens();
  const styles = createStyles(tokens);
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
  const tokens = useBrandTokens();
  const styles = createStyles(tokens);
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

/** Muted rule used between agenda rows to show buffer or open time. */
export function GapStrip({ kind, minutes }: { kind: 'recovery' | 'open'; minutes: number }) {
  const tokens = useBrandTokens();
  const styles = createStyles(tokens);
  if (kind === 'recovery') {
    return (
      <View style={styles.recoveryStrip}>
        <AppIcon name="clock" size={13} tintColor={tokens.secondary} />
        <Text style={styles.recoveryText}>{minutes} min recovery &amp; room reset</Text>
      </View>
    );
  }
  return <Text style={styles.openGapText}>{minutes} min open</Text>;
}

export function MoneyText({ cents, style }: { cents: number; style?: object }) {
  const tokens = useBrandTokens();
  const styles = createStyles(tokens);
  return <Text style={{ ...styles.money, ...(style ?? {}) }}>{formatMoney(cents)}</Text>;
}

export function EmptyState({ title, message }: { title: string; message: string }) {
  const tokens = useBrandTokens();
  const styles = createStyles(tokens);
  return (
    <Card style={styles.empty}>
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyMessage}>{message}</Text>
    </Card>
  );
}

const createStyles = (tokens: BrandTokens) => StyleSheet.create({
  badge: { borderRadius: tokens.radius.pill, paddingHorizontal: tokens.spacing.md, paddingVertical: 4, alignSelf: 'flex-start' },
  badgeText: { fontFamily: tokens.fontBody, fontSize: 11, letterSpacing: 0.2 },
  avatar: { alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontFamily: tokens.fontBody },
  statTile: {
    flexGrow: 1,
    flexBasis: '46%',
    minHeight: 96,
    borderRadius: tokens.radius.lg,
    backgroundColor: tokens.surface,
    padding: tokens.spacing.lg,
    gap: 2,
    justifyContent: 'center',
  },
  statLabel: { color: tokens.textMuted, fontFamily: tokens.fontBody, fontSize: 12 },
  statValue: { color: tokens.textPrimary, fontFamily: tokens.fontDisplay, fontSize: 26 },
  statFooter: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  statDelta: { fontFamily: tokens.fontBody, fontSize: 11 },
  statHint: { color: tokens.textMuted, fontFamily: tokens.fontBody, fontSize: 11, flexShrink: 1 },
  card: { gap: tokens.spacing.md },
  cardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: tokens.spacing.md },
  cardTitle: { color: tokens.textPrimary, fontFamily: tokens.fontBody, fontSize: 17, flexShrink: 1 },
  cardAction: { color: tokens.primary, fontFamily: tokens.fontBody, fontSize: 13 },
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
  switcherItem: { flex: 1, minHeight: 38, alignItems: 'center', justifyContent: 'center', borderRadius: tokens.radius.pill },
  switcherItemActive: { backgroundColor: tokens.primary },
  switcherText: { color: tokens.textPrimary, fontFamily: tokens.fontBody, fontSize: 14 },
  switcherTextActive: { color: tokens.surfaceElevated, fontFamily: tokens.fontBody },
  iconButton: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  iconButtonSoft: { backgroundColor: tokens.surface },
  recoveryStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    borderRadius: tokens.radius.pill,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: tokens.surface,
    paddingHorizontal: tokens.spacing.md,
    paddingVertical: 5,
  },
  recoveryText: { color: tokens.primary, fontFamily: tokens.fontBody, fontSize: 12 },
  openGapText: { color: tokens.textMuted, fontFamily: tokens.fontBody, fontSize: 12, paddingVertical: 2 },
  money: { color: tokens.textPrimary, fontFamily: tokens.fontBody, fontSize: 15 },
  empty: { alignItems: 'center', gap: 6, paddingVertical: tokens.spacing.xxl },
  emptyTitle: { color: tokens.textPrimary, fontFamily: tokens.fontBody, fontSize: 16 },
  emptyMessage: { color: tokens.textMuted, fontFamily: tokens.fontBody, fontSize: 14, textAlign: 'center' },
  pressed: { opacity: 0.75 },
});
