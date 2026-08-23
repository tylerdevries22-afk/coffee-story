import { useState } from 'react';
import { Alert, StyleSheet, Text } from 'react-native';

import { CollapsingScreen } from '@/components/collapsing-screen';
import { Body, Button, Card, PillRow } from '@/components/ui';
import { informationPages, type InformationPageKey } from '@/features/more/information-pages';
import { openWebPath } from '@/lib/web-navigation';
import { colors, fonts, radius, spacing } from '@/theme/tokens';

export const styles = StyleSheet.create({
  searchResults: { gap: spacing.xs },
  merch: { minHeight: 180, borderRadius: radius.lg, overflow: 'hidden', backgroundColor: colors.brand200, flexDirection: 'row', alignItems: 'center' },
  merchImage: { width: '46%', alignSelf: 'stretch' },
  merchCopy: { flex: 1, padding: spacing.md },
  merchTitle: { color: colors.ink900, fontFamily: fonts.display, fontSize: 28, marginTop: 6 },
  staffCard: { minHeight: 110, borderRadius: radius.lg, padding: spacing.lg, backgroundColor: colors.brand700, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  staffTitle: { color: colors.white, fontFamily: fonts.sansBold, fontSize: 17 },
  staffSubtitle: { color: colors.brand200, fontFamily: fonts.sans, fontSize: 12, lineHeight: 18, maxWidth: 240, marginTop: 5 },
  staffArrow: { color: colors.white, fontFamily: fonts.sansBold, fontSize: 13 },
  buildCard: { backgroundColor: colors.warm, gap: 4 },
  buildTitle: { color: colors.ink900, fontFamily: fonts.sansBold, fontSize: 14 },
  detailCard: { gap: spacing.sm },
  detailTitle: { color: colors.ink900, fontFamily: fonts.sansBold, fontSize: 18 },
  balance: { color: colors.ink900, fontFamily: fonts.display, fontSize: 44 },
  field: { gap: spacing.sm },
  fieldLabel: { color: colors.ink900, fontFamily: fonts.sansBold, fontSize: 14 },
  input: { minHeight: 54, borderRadius: radius.md, borderWidth: 1, borderColor: colors.ink300, paddingHorizontal: spacing.md, color: colors.ink900, fontFamily: fonts.sans, fontSize: 15, backgroundColor: colors.white },
  multiline: { minHeight: 110, paddingTop: spacing.md, textAlignVertical: 'top' },
  options: { flexDirection: 'row', gap: spacing.sm },
  option: { flex: 1, minHeight: 46 },
  visitActions: { flexDirection: 'row', gap: spacing.sm },
  visitAction: { flex: 1, minHeight: 48, paddingHorizontal: spacing.sm },
  reviewForm: { gap: spacing.md, paddingTop: spacing.sm },
  ratingRow: { flexDirection: 'row', gap: spacing.sm },
  ratingButton: { flex: 1, minHeight: 46, alignItems: 'center', justifyContent: 'center', borderRadius: radius.pill, borderWidth: 1, borderColor: colors.ink300, backgroundColor: colors.white },
  ratingButtonActive: { borderColor: colors.brand600, backgroundColor: colors.brand600 },
  ratingText: { color: colors.ink700, fontFamily: fonts.sansBold, fontSize: 15 },
  ratingTextActive: { color: colors.white },
  message: { alignSelf: 'flex-start', maxWidth: '86%', gap: 4, padding: spacing.md, backgroundColor: colors.brand50, borderRadius: radius.lg },
  myMessage: { alignSelf: 'flex-end', backgroundColor: colors.brand200 },
  messageSender: { color: colors.ink900, fontFamily: fonts.sansBold, fontSize: 11 },
});

export function openWithFeedback(path: string) {
  void openWebPath(path).catch((error: unknown) => {
    Alert.alert('Page unavailable', error instanceof Error ? error.message : 'Try again later.');
  });
}

export function InformationPage({ page, onBack }: { page: InformationPageKey; onBack: () => void }) {
  const config = informationPages()[page];
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
