import { StyleSheet, Text, View } from 'react-native';

import { CollapsingScreen } from '@/components/collapsing-screen';
import { Body, Card, SectionTitle } from '@/components/ui';
import { formatMoney, sizeLabelFor, sizePriceCents } from '@platform/domain';

import { DEMO_ADD_ONS, MENU_ITEMS } from '@/data/catalog';
import { workspaceTone } from '@/features/staff/workspace';
import { useAuth } from '@/state/auth-context';
import { hairline, useTokens as useBrandTokens, type BrandTokens } from '@platform/ui';

/**
 * The item menu, read from the catalog the app actually ships.
 *
 * What stood here was a generic placeholder fed by hand-written strings: it
 * claimed "9 Active / 4 Add-ons / $114 Average" when the studio sells 7
 * services and 3 add-ons, listed a five-minute aromatherapy that has never
 * existed, and offered an "Add item" button whose workflow discarded
 * whatever was typed into it. Numbers on an owner's screen have to come from
 * somewhere, so these are derived.
 */
export function AdminServicesScreen({ onBack }: { onBack: () => void }) {
  const tokens = useBrandTokens();
  const styles = createStyles(tokens);
  const { role } = useAuth();
  const sizes = MENU_ITEMS.flatMap((item) => item.sizes);
  const averageCents = sizes.length > 0
    ? Math.round(sizes.reduce((total, size) => total + sizePriceCents(size), 0) / sizes.length)
    : 0;

  return (
    <CollapsingScreen title="Menu" eyebrow="Catalog" onBack={onBack} tone={workspaceTone(role)}>
      <Body muted>Bookable sizes, pricing, durations, and enhancements.</Body>

      <View style={styles.metrics}>
        <Metric label="Menu items" value={String(MENU_ITEMS.length)} />
        <Metric label="Sizes" value={String(sizes.length)} />
        <Metric label="Add-ons" value={String(DEMO_ADD_ONS.length)} />
        <Metric label="Average" value={`${formatMoney(averageCents)}`} />
      </View>

      <SectionTitle>Sessions</SectionTitle>
      {MENU_ITEMS.map((item) => (
        <Card key={item.id} style={styles.card}>
          <Text style={styles.name}>{item.name}</Text>
          <Body muted>{item.description}</Body>
          {item.sizes.map((size) => (
            <View key={size.slug} style={styles.row}>
              <Text style={styles.rowLabel}>{sizeLabelFor(size.slug)}</Text>
              <Text style={styles.rowValue}>{formatMoney(sizePriceCents(size))}</Text>
            </View>
          ))}
        </Card>
      ))}

      <SectionTitle>Enhancements</SectionTitle>
      <Card style={styles.card}>
        {DEMO_ADD_ONS.map((addOn) => (
          <View key={addOn.slug} style={styles.row}>
            <Text style={styles.rowLabel}>{addOn.name}</Text>
            <Text style={styles.rowValue}>${(addOn.priceCents / 100).toFixed(0)}</Text>
          </View>
        ))}
      </Card>

      {/* Said plainly rather than left as a button that does nothing, which is
          what the placeholder did. */}
      <Body muted>
        Editing the menu from the app is not built yet. These are the live figures the website
        publishes and the app books against.
      </Body>
    </CollapsingScreen>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  const tokens = useBrandTokens();
  const styles = createStyles(tokens);
  return (
    <View style={styles.metric}>
      <Text style={styles.metricValue}>{value}</Text>
      <Text style={styles.metricLabel}>{label}</Text>
    </View>
  );
}

const createStyles = (tokens: BrandTokens) => StyleSheet.create({
  metrics: { flexDirection: 'row', gap: tokens.spacing.md },
  metric: {
    flex: 1,
    gap: 2,
    paddingVertical: tokens.spacing.md,
    alignItems: 'center',
    borderRadius: tokens.radius.lg,
    backgroundColor: tokens.surface,
  },
  metricValue: { color: tokens.textPrimary, fontFamily: tokens.fontDisplay, fontSize: 20 },
  metricLabel: {
    color: tokens.primary,
    fontFamily: tokens.fontBody,
    fontSize: 10,
    letterSpacing: 1.1,
    textTransform: 'uppercase',
  },
  card: { gap: tokens.spacing.sm, padding: tokens.spacing.lg },
  name: { color: tokens.textPrimary, fontFamily: tokens.fontDisplay, fontSize: 18 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 44,
    borderTopWidth: 1,
    borderTopColor: hairline(tokens),
  },
  rowLabel: { color: tokens.textPrimary, fontFamily: tokens.fontBody, fontSize: 15 },
  rowValue: { color: tokens.textPrimary, fontFamily: tokens.fontBody, fontSize: 16 },
});
