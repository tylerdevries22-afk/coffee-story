import { LinearGradient } from 'expo-linear-gradient';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { TENANT } from '@/tenant';
import { cashEntries } from '@/features/rewards/cash-entries';
import { formatRewardDate } from '@/features/rewards/presentation';
import type { RewardAccount, RewardEntry } from '@platform/domain';

import { useRewardStyles } from '../styles';
import { useTokens as useBrandTokens, AppIcon } from '@platform/ui';

export function CashTab({
  account,
  ledger,
  onUseCash,
  onSendGift,
}: {
  account: RewardAccount;
  ledger: RewardEntry[];
  onUseCash: () => void;
  onSendGift: () => void;
}) {
  const styles = useRewardStyles();
  const tokens = useBrandTokens();
  const entries = cashEntries(ledger);
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Use $${(account.cashCents / 100).toFixed(2)} Brew Bucks`}
        onPress={onUseCash}
        style={({ pressed }) => [styles.cashCard, pressed && styles.cashCardPressed]}
      >
        <LinearGradient
          colors={[tokens.surface, tokens.secondary]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
        <Text style={styles.cashHint}>Present at the counter</Text>
        <Text style={styles.cashBalance}>${(account.cashCents / 100).toFixed(2)}</Text>
        <View style={styles.cashBottom}>
          <View>
            <Text style={styles.cashBrand}>{TENANT.identity.name}</Text>
            <Text style={styles.cashSubbrand}>BREW BUCKS</Text>
          </View>
          <View style={styles.currencyPill}><Text style={styles.currencyText}>USD⌄</Text></View>
        </View>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        onPress={onUseCash}
        style={({ pressed }) => [styles.actionRow, pressed && styles.rowPressed]}
      >
        <AppIcon name="calendar" size={24} tintColor={tokens.textPrimary} />
        <Text style={styles.actionRowLabel}>Order with Brew Bucks on hand</Text>
        <AppIcon name="chevron.right" size={17} tintColor={tokens.textPrimary} />
      </Pressable>
      <Pressable
        accessibilityRole="button"
        onPress={onSendGift}
        style={({ pressed }) => [styles.actionRow, pressed && styles.rowPressed]}
      >
        <AppIcon name="gift" size={25} tintColor={tokens.textPrimary} />
        <Text style={styles.actionRowLabel}>Send a Digital Gift Card</Text>
        <AppIcon name="chevron.right" size={17} tintColor={tokens.textPrimary} />
      </Pressable>
      <Text style={styles.sectionTitle}>Activity</Text>
      <View style={styles.cashActivity}>
        {entries.length ? entries.map(({ entry, delta }) => (
          <CashActivityRow
            key={entry.id}
            title="Brew Bucks Earned"
            date={formatRewardDate(entry.earnedAt)}
            amount={`+$${(delta / 100).toFixed(2)}`}
            positive
          />
        )) : account.cashCents > 0 ? (
          <CashActivityRow
            title="Brew Bucks Available"
            date="Current balance"
            amount={`+$${(account.cashCents / 100).toFixed(2)}`}
            positive
          />
        ) : (
          <View style={styles.emptyActivity}>
            <Text style={styles.emptyActivityTitle}>No cash activity yet</Text>
            <Text style={styles.emptyActivityBody}>Redeem eligible rewards to add Brew Bucks.</Text>
          </View>
        )}
        {ledger.slice(0, 5).map((entry) => (
          <CashActivityRow
            key={`points-${entry.id}`}
            title={entry.description}
            date={formatRewardDate(entry.earnedAt)}
            amount={`${entry.points > 0 ? '+' : ''}${entry.points.toLocaleString()} HP`}
            positive={entry.points > 0}
          />
        ))}
      </View>
    </>
  );
}

function CashActivityRow({
  title,
  date,
  amount,
  positive,
}: {
  title: string;
  date: string;
  amount: string;
  positive: boolean;
}) {
  const styles = useRewardStyles();
  return (
    <View style={styles.activityRow}>
      <View style={styles.activityCopy}>
        <Text style={styles.activityTitle}>{title}</Text>
        <Text style={styles.activityDate}>{date}</Text>
      </View>
      <Text style={[styles.activityAmount, positive && styles.activityAmountPositive]}>{amount}</Text>
    </View>
  );
}
