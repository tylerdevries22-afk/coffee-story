import { useEffect, useState } from 'react';
import { Animated, Pressable, Text, View } from 'react-native';

import { annualPeriodYear, POINTS_LABEL, rewardProgress } from '@/features/rewards/presentation';
import { nextTier, rewardMilestoneStates, tierForAnnualPoints } from '@platform/domain';
import { TENANT_REWARD_TIERS } from '@/tenant';
import type { RewardTierName , RewardAccount } from '@platform/domain';

import { RewardMark } from '../reward-mark';
import { DemoTierToggle } from '../demo-tier-toggle';
import { perkDescription } from '../sheets';
import { useRewardStyles } from '../styles';
import type { PerkDetail } from '../types';
import { useTokens as useBrandTokens, AppIcon, expandedState } from '@platform/ui';

import { PerkRow, ProgressHalo } from './status-tab-components';

export function StatusTab({
  account,
  onPerk,
  reducedMotion,
  isDemo,
  tierValue,
  onTierChange,
}: {
  account: RewardAccount;
  onPerk: (perk: PerkDetail) => void;
  reducedMotion: boolean;
  isDemo: boolean;
  tierValue: RewardTierName;
  onTierChange: (tier: RewardTierName) => void;
}) {
  const styles = useRewardStyles();
  const tokens = useBrandTokens();
  const tier = tierForAnnualPoints(account.annualPoints, TENANT_REWARD_TIERS);
  const upcoming = nextTier(account.annualPoints, TENANT_REWARD_TIERS);
  const progress = upcoming
    ? rewardProgress(account.annualPoints, tier.minimumAnnualPoints, upcoming.minimumAnnualPoints)
    : rewardProgress(account.annualPoints, tier.minimumAnnualPoints, tier.minimumAnnualPoints + 1);
  const unlockedPerks = TENANT_REWARD_TIERS
    .filter((item) => item.minimumAnnualPoints <= account.annualPoints)
    .flatMap((item) => item.perks.map((label) => ({ label, tier: item.name })));
  const periodYear = annualPeriodYear(account.annualPeriodStart);
  const milestoneStates = rewardMilestoneStates(account.annualPoints, TENANT_REWARD_TIERS);
  const [progressOpen, setProgressOpen] = useState(false);
  const [progressReveal] = useState(() => new Animated.Value(0));

  useEffect(() => {
    if (reducedMotion) {
      progressReveal.setValue(progressOpen ? 1 : 0);
      return;
    }
    Animated.spring(progressReveal, {
      toValue: progressOpen ? 1 : 0,
      damping: 21,
      stiffness: 240,
      mass: 0.85,
      useNativeDriver: false,
    }).start();
  }, [progressOpen, progressReveal, reducedMotion]);

  return (
    <>
      <View style={styles.statusHero}>
        <ProgressHalo progress={upcoming ? progress.ratio : 1} reducedMotion={reducedMotion} tier={tier.name} />
        <Text style={styles.statusName}>{tier.name}</Text>
        <View style={styles.statusChip}>
          <Text style={styles.statusChipText}>
            {account.annualPoints.toLocaleString()} {POINTS_LABEL} Earned in {periodYear}
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          {...expandedState(progressOpen)}
          accessibilityLabel={`${periodYear + 1} rewards progress`}
          onPress={() => setProgressOpen((open) => !open)}
          style={styles.statusCarryRow}
        >
          <Text style={styles.statusCarry}>Your status continues through {periodYear + 1}.</Text>
          <AppIcon
            name="chevron.down"
            size={17}
            tintColor={tokens.textMuted}
            style={progressOpen ? styles.progressChevronOpen : undefined}
          />
        </Pressable>
        {upcoming ? (
          <Animated.View
            style={[
              styles.progressDropdown,
              {
                height: progressReveal.interpolate({ inputRange: [0, 1], outputRange: [0, 116] }),
                opacity: progressReveal,
              },
            ]}
          >
            <View style={styles.progressCard}>
              <View style={styles.progressHeader}>
                <View style={styles.progressTitleWrap}>
                  <RewardMark compact />
                  <Text style={styles.progressTitle}>{periodYear + 1} Progress: {tier.name}</Text>
                </View>
                <Text style={styles.progressRemaining}>{progress.remaining.toLocaleString()} → {upcoming.name}</Text>
              </View>
              <View style={styles.progressTrack}>
                <View style={[styles.progressFill, { width: `${Math.max(4, progress.ratio * 100)}%` }]} />
              </View>
              <View style={styles.progressMilestones}>
                {milestoneStates.map((complete, index) => (
                  <Text key={TENANT_REWARD_TIERS[index]?.name ?? index} style={complete ? styles.progressCheck : styles.progressLock}>
                    {complete ? '✓' : '◇'}
                  </Text>
                ))}
              </View>
            </View>
          </Animated.View>
        ) : null}
        {isDemo ? (
          <DemoTierToggle
            annualPoints={account.annualPoints}
            value={tierValue}
            onChange={onTierChange}
          />
        ) : null}
      </View>
      <Text style={styles.sectionTitle}>My Perks</Text>
      <View style={styles.rewardList}>
        {unlockedPerks.map(({ label, tier: perkTier }) => (
          <PerkRow
            key={`${perkTier}-${label}`}
            label={label}
            locked={false}
            onPress={() => onPerk({
              label,
              tier: `${perkTier} Perk`,
              description: perkDescription(label),
              locked: false,
            })}
          />
        ))}
      </View>
      {upcoming ? (
        <>
          <Text style={styles.sectionTitle}>Unlock More Perks</Text>
          <View style={styles.nextTierBanner}>
            <View style={styles.crownMark}><Text style={styles.crownText}>♕</Text></View>
            <View style={styles.nextTierCopy}>
              <Text style={styles.nextTierName}>{upcoming.name}</Text>
              <Text style={styles.nextTierThreshold}>
                {upcoming.minimumAnnualPoints.toLocaleString()} {POINTS_LABEL} Earned in {periodYear}
              </Text>
            </View>
            <AppIcon name="lock.fill" size={23} tintColor={tokens.primary} />
          </View>
          <View style={styles.rewardList}>
            {upcoming.perks.map((label) => (
              <PerkRow
                key={label}
                label={label}
                locked
                onPress={() => onPerk({
                  label,
                  tier: `${upcoming.name} Perk`,
                  description: perkDescription(label),
                  locked: true,
                })}
              />
            ))}
            <PerkRow
              label={`Earn ${upcoming.pointsPerDollar} ${POINTS_LABEL} for every $1 spent`}
              locked
              onPress={() => onPerk({
                label: `Earn ${upcoming.pointsPerDollar} for every $1 spent`,
                tier: `${upcoming.name} Perk`,
                description: `Reach ${upcoming.minimumAnnualPoints.toLocaleString()} annual ${POINTS_LABEL} to unlock a faster earning rate on eligible purchases.`,
                locked: true,
              })}
            />
          </View>
        </>
      ) : null}
    </>
  );
}
