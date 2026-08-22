import { useEffect, useState } from 'react';
import { Animated, Pressable, Text, View, useWindowDimensions } from 'react-native';

import { AppIcon } from '@/components/icon';
import { GlassCup } from '@/components/rewards/glass-cup';
import { annualPeriodYear, HEART_POINTS_LABEL, rewardProgress } from '@/features/rewards/presentation';
import { nextTier, REWARD_TIERS, rewardMilestoneStates, tierForAnnualPoints } from '@/features/rewards/rules';
import type { RewardTierName } from '@/features/rewards/rules';
import type { RewardAccount } from '@/types/domain';
import { colors } from '@/theme/tokens';

import { RewardMark } from '../reward-mark';
import { DemoTierToggle } from '../demo-tier-toggle';
import { perkDescription } from '../sheets';
import { styles } from '../styles';
import type { PerkDetail } from '../types';

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
  const tier = tierForAnnualPoints(account.annualPoints);
  const upcoming = nextTier(account.annualPoints);
  const progress = upcoming
    ? rewardProgress(account.annualPoints, tier.minimumAnnualPoints, upcoming.minimumAnnualPoints)
    : rewardProgress(account.annualPoints, tier.minimumAnnualPoints, tier.minimumAnnualPoints + 1);
  const unlockedPerks = REWARD_TIERS
    .filter((item) => item.minimumAnnualPoints <= account.annualPoints)
    .flatMap((item) => item.perks.map((label) => ({ label, tier: item.name })));
  const periodYear = annualPeriodYear(account.annualPeriodStart);
  const milestoneStates = rewardMilestoneStates(account.annualPoints);
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
            {account.annualPoints.toLocaleString()} {HEART_POINTS_LABEL} Earned in {periodYear}
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: progressOpen }}
          accessibilityLabel={`${periodYear + 1} rewards progress`}
          onPress={() => setProgressOpen((open) => !open)}
          style={styles.statusCarryRow}
        >
          <Text style={styles.statusCarry}>Your status continues through {periodYear + 1}.</Text>
          <AppIcon
            name="chevron.down"
            size={17}
            tintColor={colors.ink500}
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
                  <Text key={REWARD_TIERS[index]?.name ?? index} style={complete ? styles.progressCheck : styles.progressLock}>
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
                {upcoming.minimumAnnualPoints.toLocaleString()} {HEART_POINTS_LABEL} Earned in {periodYear}
              </Text>
            </View>
            <AppIcon name="lock.fill" size={23} tintColor={colors.brand600} />
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
              label={`Earn ${upcoming.pointsPerDollar} ${HEART_POINTS_LABEL} for every $1 spent`}
              locked
              onPress={() => onPerk({
                label: `Earn ${upcoming.pointsPerDollar} for every $1 spent`,
                tier: `${upcoming.name} Perk`,
                description: `Reach ${upcoming.minimumAnnualPoints.toLocaleString()} annual ${HEART_POINTS_LABEL} to unlock a faster earning rate on eligible purchases.`,
                locked: true,
              })}
            />
          </View>
        </>
      ) : null}
    </>
  );
}

function ProgressHalo({ progress, reducedMotion, tier }: { progress: number; reducedMotion: boolean; tier: RewardTierName }) {
  const { width } = useWindowDimensions();
  const size = Math.min(310, width - 86);
  const center = size / 2;
  const radiusValue = size / 2 - 13;
  const segments = 34;
  const [animation] = useState(() => new Animated.Value(reducedMotion ? 1 : 0));

  useEffect(() => {
    if (reducedMotion) {
      animation.setValue(1);
      return;
    }
    Animated.timing(animation, { toValue: 1, duration: 700, useNativeDriver: true }).start();
  }, [animation, reducedMotion]);

  return (
    <View accessibilityLabel={`${Math.round(progress * 100)} percent toward the next rewards status`} style={{ width: size, height: size * 0.82 }}>
      {Array.from({ length: segments }, (_, index) => {
        const angle = -150 + (300 / (segments - 1)) * index;
        const radians = (angle * Math.PI) / 180;
        const active = index / (segments - 1) <= progress;
        return (
          <Animated.View
            key={angle}
            style={[
              styles.haloSegment,
              {
                left: center + Math.cos(radians) * radiusValue - 3,
                top: center + Math.sin(radians) * radiusValue - 9,
                backgroundColor: active ? colors.gold300 : colors.ink200,
                opacity: animation,
                transform: [
                  { rotate: `${angle + 90}deg` },
                  { scaleY: animation },
                ],
              },
            ]}
          />
        );
      })}
      <View style={[styles.haloCenter, { left: center - 70, top: center - 70 }]}>
        <GlassCup
          size={110}
          fillPercent={1}
          tier={tier}
          replayKey={tier}
          accessibilityLabel={`${tier} status cup`}
        />
      </View>
    </View>
  );
}

function PerkRow({ label, locked, onPress }: { label: string; locked: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}. ${locked ? 'Locked' : 'Unlocked'}`}
      onPress={onPress}
      style={({ pressed }) => [styles.perkRow, pressed && styles.rowPressed]}
    >
      <View style={[styles.perkIcon, locked && styles.perkIconLocked]}>
        <Text style={styles.perkIconText}>{locked ? '♕' : '✦'}</Text>
      </View>
      <Text style={styles.perkLabel}>{label}</Text>
      <AppIcon name="chevron.right" size={17} tintColor={colors.ink500} />
    </Pressable>
  );
}
