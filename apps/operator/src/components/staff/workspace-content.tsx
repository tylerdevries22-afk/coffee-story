import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Card } from '@/components/ui';
import { deltaPercent, formatMoney } from '@/features/staff/workspace';
import { AppIcon, useTokens as useBrandTokens, type BrandTokens } from '@platform/ui';

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
  const styles = createStyles(useBrandTokens());
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
  const styles = createStyles(useBrandTokens());
  return <Text style={{ ...styles.money, ...(style ?? {}) }}>{formatMoney(cents)}</Text>;
}

export function EmptyState({ title, message }: { title: string; message: string }) {
  const styles = createStyles(useBrandTokens());
  return (
    <Card style={styles.empty}>
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyMessage}>{message}</Text>
    </Card>
  );
}

const createStyles = (tokens: BrandTokens) => StyleSheet.create({
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
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: tokens.spacing.md,
  },
  cardTitle: { color: tokens.textPrimary, fontFamily: tokens.fontBody, fontSize: 17, flexShrink: 1 },
  cardAction: { color: tokens.primary, fontFamily: tokens.fontBody, fontSize: 13 },
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
  emptyMessage: {
    color: tokens.textMuted,
    fontFamily: tokens.fontBody,
    fontSize: 14,
    textAlign: 'center',
  },
});
