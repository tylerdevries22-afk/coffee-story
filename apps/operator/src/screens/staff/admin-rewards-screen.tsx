import { StyleSheet, Text, View } from 'react-native';

import { CollapsingScreen } from '@/components/collapsing-screen';
import { Body, Card } from '@/components/ui';
import { REWARD_TIERS, pointsForPurchase } from '@platform/domain';
import { workspaceTone } from '@/features/staff/workspace';
import { useAuth } from '@/state/auth-context';
import { useTokens as useBrandTokens, type BrandTokens } from '@platform/ui';

/**
 * Read-only: the ladder is authored on the web admin, which is where reordering
 * rows and editing perk lists is actually workable. This screen shows what is
 * published.
 *
 * Unlike the other native admin destinations it is not gated behind demo mode.
 * The earning maths comes from `@/features/rewards/rules` -- the module the app
 * already earns and redeems with -- so the page is truthful even with no
 * backend, falling back to the bundled ladder.
 */

// The same worked example the web admin shows, run through the same function.
const EXAMPLE = {
  itemsCents: 14_000,
  giftCardsCents: 0,
  deliveryCents: 0,
  tipsCents: 2_000,
  taxesCents: 1_120,
  serviceFeesCents: 0,
  paidWithGiftCardCents: 0,
  paidWithRewardsCents: 0,
} as const;

const QUALIFYING: readonly { label: string; earns: boolean }[] = [
  { label: 'Services', earns: true },
  { label: 'Gift cards', earns: true },
  { label: 'Delivery', earns: true },
  { label: 'Tips', earns: true },
  { label: 'Taxes', earns: false },
  { label: 'MenuItem fees', earns: false },
];

function Row({ label, value }: { label: string; value: string }) {
  const tokens = useBrandTokens();
  const styles = createStyles(tokens);
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

export function AdminRewardsScreen({ onBack }: { onBack: () => void }) {
  const tokens = useBrandTokens();
  const styles = createStyles(tokens);
  const { role } = useAuth();
  // The bundled ladder is the truth until brand_config carries tiers (the
  // white-label sweep); the legacy portal endpoint this used to poll is gone.
  const tiers = REWARD_TIERS;

  const examplePoints = pointsForPurchase(EXAMPLE, 0, tiers);

  return (
    <CollapsingScreen title="Rewards & points" eyebrow="Loyalty program" onBack={onBack} tone={workspaceTone(role)}>
      <Body muted>Tiers, earning rules, and expiry exactly as the system applies them.</Body>

      <Card style={styles.card}>
        <Text style={styles.heading}>Tier ladder</Text>
        {tiers.map((tier) => (
          <View key={tier.name} style={styles.tier}>
            <View style={styles.tierHead}>
              <Text style={styles.tierName}>{tier.name}</Text>
              <Text style={styles.tierRate}>{tier.pointsPerDollar} pts / $1</Text>
            </View>
            {tier.description ? <Body muted>{tier.description}</Body> : null}
            <Body muted>
              Reached at {tier.minimumAnnualPoints.toLocaleString()} pts/yr · {tier.perks.join(', ')}
            </Body>
          </View>
        ))}
        <Body muted>Tier follows points earned in the trailing year, so it can fall as well as rise.</Body>
      </Card>

      <Card style={styles.card}>
        <Text style={styles.heading}>What earns points</Text>
        {QUALIFYING.map((line) => (
          <Row key={line.label} label={line.label} value={line.earns ? 'Earns' : 'Excluded'} />
        ))}
        <Body muted>
          Amounts paid with a gift card or with redeemed points are subtracted before earning, so points
          cannot mint more points.
        </Body>
      </Card>

      <Card style={styles.card}>
        <Text style={styles.heading}>Earning and expiry</Text>
        <Row label="Rounding" value="Down, to a whole point" />
        <Row label="Points expire" value="1 year after earned" />
        <Row
          label="$8 drink + $2 tip"
          value={`${examplePoints.toLocaleString()} pts at ${tiers[0]?.name ?? REWARD_TIERS[0].name}`}
        />
      </Card>
    </CollapsingScreen>
  );
}

const createStyles = (tokens: BrandTokens) => StyleSheet.create({
  card: { gap: tokens.spacing.md },
  heading: { color: tokens.textPrimary, fontFamily: tokens.fontBody, fontSize: 16 },
  tier: { gap: 2, paddingTop: tokens.spacing.md, borderTopWidth: 1, borderTopColor: 'rgba(70,48,78,0.12)' },
  tierHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: tokens.spacing.md },
  tierName: { color: tokens.textPrimary, fontFamily: tokens.fontBody, fontSize: 15 },
  tierRate: { color: tokens.textPrimary, fontFamily: tokens.fontBody, fontSize: 13 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: tokens.spacing.md,
    paddingTop: tokens.spacing.md,
    borderTopWidth: 1,
    borderTopColor: 'rgba(70,48,78,0.12)',
  },
  rowLabel: { flex: 1, color: tokens.textPrimary, fontFamily: tokens.fontBody, fontSize: 15 },
  rowValue: { color: tokens.textPrimary, fontFamily: tokens.fontBody, fontSize: 14 },
});
