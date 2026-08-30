import { StyleSheet, Text, View } from 'react-native';

import { CollapsingScreen } from '@/components/collapsing-screen';
import { Body, Card, SectionTitle } from '@/components/ui';
import { formatMoney } from '@platform/domain';

import { workspaceTone } from '@/features/staff/workspace';
import { useAuth } from '@/state/auth-context';
import { useStaffWorkspace } from '@/state/staff-workspace';
import { hairline, useTokens as useBrandTokens, type BrandTokens } from '@platform/ui';

/**
 * The item menu of whichever shop is signed in.
 *
 * Numbers on an owner's screen have to come from somewhere, so these are
 * derived rather than written by hand. The source is the workspace's own
 * catalogue: it used to be the menu bundled in this binary, which is the
 * launch shop's, and one listing serves every tenant (rule 7) -- so a second
 * brand's owner was shown another shop's 61 items, its prices, and a line
 * calling them "the live figures the website publishes".
 *
 * Live accounts have no catalogue endpoint yet, so the honest answer there is
 * an empty one, said plainly.
 */
export function AdminServicesScreen({ onBack }: { onBack: () => void }) {
  const tokens = useBrandTokens();
  const styles = createStyles(tokens);
  const { role } = useAuth();
  const { orderableItems } = useStaffWorkspace();
  const averageCents = orderableItems.length > 0
    ? Math.round(orderableItems.reduce((total, item) => total + item.priceCents, 0) / orderableItems.length)
    : 0;

  return (
    <CollapsingScreen title="Menu" eyebrow="Catalog" onBack={onBack} tone={workspaceTone(role)}>
      <Body muted>What this shop sells, and what it charges.</Body>

      <View style={styles.metrics}>
        <Metric label="Menu items" value={String(orderableItems.length)} />
        <Metric label="Average" value={`${formatMoney(averageCents)}`} />
      </View>

      <SectionTitle>Items</SectionTitle>
      {orderableItems.length === 0 ? (
        <Card style={styles.card}>
          <Body muted>
            This shop&rsquo;s catalog is not readable from the app yet. Menu and pricing live in
            HQ, under Catalog.
          </Body>
        </Card>
      ) : null}
      {orderableItems.map((item) => (
        <Card key={item.slug} style={styles.card}>
          <Text style={styles.name}>{item.name}</Text>
          {item.description ? <Body muted>{item.description}</Body> : null}
          <View style={styles.row}>
            <Text style={styles.rowLabel}>{item.ounces ? `${item.ounces} oz` : 'Each'}</Text>
            <Text style={styles.rowValue}>{formatMoney(item.priceCents)}</Text>
          </View>
        </Card>
      ))}

      {/* Said plainly rather than left as a button that does nothing, which is
          what the placeholder did. */}
      <Body muted>Editing the menu from the app is not built yet. Change it in HQ.</Body>
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
