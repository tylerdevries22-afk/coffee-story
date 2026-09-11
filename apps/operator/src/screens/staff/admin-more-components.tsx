import type { ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';

import { Body, PillRow, Screen } from '@/components/ui';
import type { AdminSearchResult } from '@/features/admin/admin-navigation';
import { AppIcon, type AppIconName, useAppTokens } from '@platform/ui';

import { createAdminMoreStyles } from './admin-more-styles';

export function MoreGroup({ label, children }: { label?: string; children: ReactNode }) {
  const styles = createAdminMoreStyles(useAppTokens());
  return (
    <View style={styles.groupWrap}>
      {label ? <Text style={styles.groupLabel}>{label}</Text> : null}
      <View style={styles.group}>{children}</View>
    </View>
  );
}

export function MoreRow({ title, subtitle, symbol, leading, onPress, first = false }: {
  title: string;
  subtitle?: string;
  symbol?: AppIconName;
  leading?: ReactNode;
  onPress: () => void;
  first?: boolean;
}) {
  const appTokens = useAppTokens();
  const { colors } = appTokens;
  const styles = createAdminMoreStyles(appTokens);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={subtitle ? `${title}, ${subtitle}` : title}
      onPress={onPress}
      style={({ pressed }) => [styles.row, !first && styles.rowDivider, pressed && styles.pressed]}
    >
      {leading ?? (symbol ? (
        <View style={styles.rowIcon}>
          <AppIcon name={symbol} size={19} tintColor={colors.ink700} />
        </View>
      ) : null)}
      <View style={styles.rowCopy}>
        <Text numberOfLines={1} style={styles.rowTitle}>{title}</Text>
        {subtitle ? <Text numberOfLines={1} style={styles.rowSubtitle}>{subtitle}</Text> : null}
      </View>
      <AppIcon name="chevron.right" size={16} tintColor={colors.ink400} />
    </Pressable>
  );
}

export function WorkspaceSearchResults({
  query,
  results,
  onResult,
}: {
  query: string;
  results: readonly AdminSearchResult[];
  onResult: (result: AdminSearchResult) => void;
}) {
  return (
    <Screen keyboardShouldPersistTaps="handled">
      {!query.trim() ? <Body muted>Search guests, schedule, reports and settings.</Body> : null}
      {query.trim() && !results.length ? <Body muted>Nothing matches “{query.trim()}”.</Body> : null}
      {results.map((result) => (
        <PillRow
          key={result.id}
          title={result.title}
          subtitle={result.subtitle}
          symbol={result.kind === 'client' ? 'person.crop.circle' : 'doc.text'}
          onPress={() => onResult(result)}
        />
      ))}
    </Screen>
  );
}

export function destinationSymbol(path: string): AppIconName {
  if (path.includes('calendar')) return 'calendar';
  if (path.includes('client') || path.includes('staff') || path.includes('talent')) {
    return 'person.crop.circle';
  }
  if (path.includes('pos')) return 'creditcard';
  if (path.includes('review')) return 'star';
  if (path.includes('settings')) return 'gearshape';
  if (path.includes('dashboard')) return 'square.grid.2x2';
  if (path.includes('marketing') || path.includes('analytics') || path.includes('ads')) return 'message';
  return 'doc.text';
}
