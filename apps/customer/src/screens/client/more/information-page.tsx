import { useState } from 'react';
import { Alert, StyleSheet, Text } from 'react-native';

import { CollapsingScreen } from '@/components/collapsing-screen';
import { Body, Button, Card, PillRow } from '@/components/ui';
import { resolveInformationPages, type InformationPageKey } from '@platform/domain';
import { openWebPath } from '@/lib/web-navigation';
import { TENANT_BRAND_CONFIG } from '@/tenant';
import { useTokens as useBrandTokens, type BrandTokens } from '@platform/ui';

export const createStyles = (tokens: BrandTokens) => StyleSheet.create({
  searchResults: { gap: tokens.spacing.sm },
  merch: { minHeight: 180, borderRadius: tokens.radius.lg, overflow: 'hidden', backgroundColor: tokens.surface, flexDirection: 'row', alignItems: 'center' },
  merchImage: { width: '46%', alignSelf: 'stretch' },
  merchCopy: { flex: 1, padding: tokens.spacing.lg },
  merchTitle: { color: tokens.textPrimary, fontFamily: tokens.fontDisplay, fontSize: 28, marginTop: 6 },
  staffCard: { minHeight: 110, borderRadius: tokens.radius.lg, padding: tokens.spacing.xl, backgroundColor: tokens.primary, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  staffTitle: { color: tokens.surfaceElevated, fontFamily: tokens.fontBody, fontSize: 17 },
  staffSubtitle: { color: tokens.surface, fontFamily: tokens.fontBody, fontSize: 12, lineHeight: 18, maxWidth: 240, marginTop: 5 },
  staffArrow: { color: tokens.surfaceElevated, fontFamily: tokens.fontBody, fontSize: 13 },
  buildCard: { backgroundColor: tokens.surface, gap: 4 },
  buildTitle: { color: tokens.textPrimary, fontFamily: tokens.fontBody, fontSize: 14 },
  detailCard: { gap: tokens.spacing.md },
  detailTitle: { color: tokens.textPrimary, fontFamily: tokens.fontBody, fontSize: 18 },
  balance: { color: tokens.textPrimary, fontFamily: tokens.fontDisplay, fontSize: 44 },
  field: { gap: tokens.spacing.md },
  fieldLabel: { color: tokens.textPrimary, fontFamily: tokens.fontBody, fontSize: 14 },
  input: { minHeight: 54, borderRadius: tokens.radius.lg, borderWidth: 1, borderColor: tokens.textMuted, paddingHorizontal: tokens.spacing.lg, color: tokens.textPrimary, fontFamily: tokens.fontBody, fontSize: 15, backgroundColor: tokens.surfaceElevated },
  multiline: { minHeight: 110, paddingTop: tokens.spacing.lg, textAlignVertical: 'top' },
  options: { flexDirection: 'row', gap: tokens.spacing.md },
  option: { flex: 1, minHeight: 46 },
  orderActions: { flexDirection: 'row', gap: tokens.spacing.md },
  orderAction: { flex: 1, minHeight: 48, paddingHorizontal: tokens.spacing.md },
  reviewForm: { gap: tokens.spacing.lg, paddingTop: tokens.spacing.md },
  ratingRow: { flexDirection: 'row', gap: tokens.spacing.md },
  ratingButton: { flex: 1, minHeight: 46, alignItems: 'center', justifyContent: 'center', borderRadius: tokens.radius.pill, borderWidth: 1, borderColor: tokens.textMuted, backgroundColor: tokens.surfaceElevated },
  ratingButtonActive: { borderColor: tokens.primary, backgroundColor: tokens.primary },
  ratingText: { color: tokens.textPrimary, fontFamily: tokens.fontBody, fontSize: 15 },
  ratingTextActive: { color: tokens.surfaceElevated },
  message: { alignSelf: 'flex-start', maxWidth: '86%', gap: 4, padding: tokens.spacing.lg, backgroundColor: tokens.surface, borderRadius: tokens.radius.lg },
  myMessage: { alignSelf: 'flex-end', backgroundColor: tokens.surface },
  messageSender: { color: tokens.textPrimary, fontFamily: tokens.fontBody, fontSize: 11 },
});

/**
 * Resolved once: brand.json is compiled into the bundle, so there is nothing
 * for a render to react to.
 */
const INFORMATION_PAGES = resolveInformationPages(TENANT_BRAND_CONFIG);

export function useInformationStyles() { return createStyles(useBrandTokens()); }

export function openWithFeedback(path: string) {
  void openWebPath(path).catch((error: unknown) => {
    Alert.alert('Page unavailable', error instanceof Error ? error.message : 'Try again later.');
  });
}

export function InformationPage({ page, onBack }: { page: InformationPageKey; onBack: () => void }) {
  const tokens = useBrandTokens();
  const styles = createStyles(tokens);
  const config = INFORMATION_PAGES[page];
  const webPath = config.webPath;
  const action = config.action;
  const [selected, setSelected] = useState(config.rows[0]?.title ?? '');
  const selectedRow = config.rows.find((row) => row.title === selected);
  return (
    <CollapsingScreen title={config.title} eyebrow={config.eyebrow} onBack={onBack}>
      <Body muted>{config.summary}</Body>
      {config.rows.map((row) => (
        <PillRow
          key={row.title}
          title={row.title}
          subtitle={row.title === selected ? 'Showing below' : 'Tap to read'}
          symbol="doc.text"
          onPress={() => setSelected(row.title)}
        />
      ))}
      {selectedRow ? (
        <Card style={styles.detailCard}>
          <Text style={styles.detailTitle}>{selectedRow.title}</Text>
          <Body>{selectedRow.detail}</Body>
        </Card>
      ) : null}
      {webPath && action ? (
        <Button label={action} variant="secondary" onPress={() => openWithFeedback(webPath)} />
      ) : null}
    </CollapsingScreen>
  );
}
