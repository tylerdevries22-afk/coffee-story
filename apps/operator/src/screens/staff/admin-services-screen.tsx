import { StyleSheet, Text, View } from 'react-native';

import { CollapsingScreen } from '@/components/collapsing-screen';
import { Body, Card, SectionTitle } from '@/components/ui';
import { formatMoney, sizeLabelFor, sizePriceCents } from '@platform/domain';

import { DEMO_ADD_ONS, MENU_ITEMS } from '@/data/catalog';
import { workspaceTone } from '@/features/staff/workspace';
import { useAuth } from '@/state/auth-context';
import { colors, fonts, radius, spacing } from '@/theme/tokens';

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
  return (
    <View style={styles.metric}>
      <Text style={styles.metricValue}>{value}</Text>
      <Text style={styles.metricLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  metrics: { flexDirection: 'row', gap: spacing.sm },
  metric: {
    flex: 1,
    gap: 2,
    paddingVertical: spacing.sm,
    alignItems: 'center',
    borderRadius: radius.md,
    backgroundColor: colors.brand50,
  },
  metricValue: { color: colors.ink900, fontFamily: fonts.display, fontSize: 20 },
  metricLabel: {
    color: colors.brand600,
    fontFamily: fonts.sansBold,
    fontSize: 10,
    letterSpacing: 1.1,
    textTransform: 'uppercase',
  },
  card: { gap: spacing.xs, padding: spacing.md },
  name: { color: colors.ink900, fontFamily: fonts.display, fontSize: 18 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 44,
    borderTopWidth: 1,
    borderTopColor: 'rgba(70,48,78,0.12)',
  },
  rowLabel: { color: colors.ink700, fontFamily: fonts.sans, fontSize: 15 },
  rowValue: { color: colors.ink900, fontFamily: fonts.sansBold, fontSize: 16 },
});
