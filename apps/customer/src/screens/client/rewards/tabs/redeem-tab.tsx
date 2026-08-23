import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { GestureDetector } from 'react-native-gesture-handler';

import { GlassCup, POUR_MS, pourFillAt, useLiquidDrag } from '@/components/rewards/glass-cup';
import { POINTS_LABEL } from '@/features/rewards/presentation';
import { nextRewardForBalance, rewardFillPercent, rewardIsLocked } from '@/features/rewards/redeem';
import { tierForAnnualPoints } from '@platform/domain';
import { colors } from '@/theme/tokens';
import type { RewardAccount, RewardCatalogItem } from '@platform/domain';
import { AppIcon } from '@/components/icon';

import { hapticSelection } from '../haptics';
import { RewardMark } from '../reward-mark';
import { styles } from '../styles';
import type { RewardDetail } from '../types';

/**
 * Counts to `target` on the same clock and curve as the liquid pour, so the
 * digits and the fill rise and settle together. A plain state ticker rather
 * than a shared value: a Text driven by one renders blank on Fabric.
 */
function useCountUp(target: number, reduced: boolean, replayKey?: string | number): number {
  const [display, setDisplay] = useState(0);
  useEffect(() => {
    if (reduced) return undefined;
    // Sampled fine enough that the digits climb smoothly across the pour.
    const steps = 60;
    let step = 0;
    const timer = setInterval(() => {
      step += 1;
      setDisplay(Math.round(target * pourFillAt(step / steps)));
      if (step >= steps) clearInterval(timer);
    }, POUR_MS / steps);
    return () => clearInterval(timer);
  }, [target, reduced, replayKey]);
  return reduced ? target : display;
}

export function RedeemTab({
  account,
  catalog,
  redeeming,
  reducedMotion,
  onSelect,
}: {
  account: RewardAccount;
  catalog: RewardCatalogItem[];
  redeeming: string | null;
  reducedMotion: boolean;
  onSelect: (detail: RewardDetail) => void;
}) {
  const tier = tierForAnnualPoints(account.annualPoints);
  const { dragAngle, dragLateral, gesture } = useLiquidDrag(!reducedMotion);
  // Keyed on the tier so the demo switch replays the pour and the counter
  // together, even when the fill percentage happens to be unchanged.
  const displayPoints = useCountUp(account.availablePoints, reducedMotion, tier.name);
  const nextReward = nextRewardForBalance(catalog, account.availablePoints);
  const heroFillPercent = nextReward
    ? rewardFillPercent(account.availablePoints, nextReward.pointsCost)
    : 1;
  return (
    <>
      <GestureDetector gesture={gesture}>
        <View style={styles.pointsHero}>
          <LinearGradient
            colors={[colors.gold50, colors.gold300]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={StyleSheet.absoluteFill}
          />
          <View style={styles.pointsCopy}>
            <Text style={styles.pointsLabel}>My {POINTS_LABEL}</Text>
            <Text style={styles.pointsNumber}>{displayPoints.toLocaleString()}</Text>
            <View style={styles.earnRatePill}>
              <RewardMark compact />
              <Text style={styles.earnRateText}>Earn {tier.pointsPerDollar} for every $1</Text>
            </View>
          </View>
          <GlassCup
            size={116}
            fillPercent={heroFillPercent}
            tier={tier.name}
            drag={{ dragAngle, dragLateral }}
            replayKey={tier.name}
            accessibilityLabel={`${Math.round(heroFillPercent * 100)} percent toward your next reward`}
          />
        </View>
      </GestureDetector>
      <Text style={styles.sectionTitle}>Redeem</Text>
      <View style={styles.rewardList}>
        {catalog.map((reward) => (
          <RewardRow
            key={reward.id}
            reward={reward}
            availablePoints={account.availablePoints}
            tierName={tier.name}
            locked={rewardIsLocked(reward, account.availablePoints)}
            loading={redeeming === reward.id}
            onPress={() => onSelect({
              reward,
              locked: rewardIsLocked(reward, account.availablePoints),
            })}
          />
        ))}
      </View>
      <Text style={styles.footnote}>
        {POINTS_LABEL} expire one year after they are earned. Eligible rewards apply automatically at checkout.
      </Text>
    </>
  );
}

function RewardRow({
  reward,
  availablePoints,
  tierName,
  locked,
  loading,
  onPress,
}: {
  reward: RewardCatalogItem;
  availablePoints: number;
  tierName: ReturnType<typeof tierForAnnualPoints>['name'];
  locked: boolean;
  loading: boolean;
  onPress: () => void;
}) {
  const rowFill = rewardFillPercent(availablePoints, reward.pointsCost);
  const content = (
    <>
      <View style={styles.rewardHeart}>
        <GlassCup
          size={44}
          fillPercent={rowFill}
          tier={tierName}
          decorated={false}
          accessibilityLabel={`${Math.round(rowFill * 100)} percent of the points needed`}
        />
      </View>
      <View style={styles.rewardCopy}>
        <Text style={[styles.rewardTitle, locked && styles.lockedText]}>{reward.name}</Text>
        <Text style={[styles.rewardCost, locked && styles.lockedText]}>
          {loading ? 'Redeeming…' : `${reward.pointsCost.toLocaleString()} ${POINTS_LABEL}`}
        </Text>
      </View>
      {locked ? (
        <AppIcon name="lock.fill" size={22} tintColor={colors.ink400} />
      ) : (
        <AppIcon name="chevron.right" size={18} tintColor={colors.ink500} />
      )}
    </>
  );
  return loading ? (
    <View style={styles.rewardRow}>{content}</View>
  ) : (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${locked ? 'View locked' : 'View'} ${reward.name} reward`}
      testID={`rewards-row-${reward.id}`}
      onPress={() => {
        hapticSelection();
        onPress();
      }}
      style={({ pressed }) => [
        styles.rewardRow,
        locked && styles.rewardRowLocked,
        pressed && styles.rowPressed,
      ]}
    >
      {content}
    </Pressable>
  );
}
