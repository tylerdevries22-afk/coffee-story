import {
  useRef,
  useState,
} from 'react';
import {
  Alert,
  View,
  useWindowDimensions,
} from 'react-native';

import { Screen } from '@/components/ui';
import { POINTS_LABEL } from '@/features/rewards/presentation';
import { useReducedMotion } from '@platform/ui';
import { tierForAnnualPoints, type RewardTierName , RewardCatalogItem } from '@platform/domain';
import { mobileApi } from '@/lib/mobile-api';
import { useAppState } from '@/state/app-context';
import { useAuth } from '@/state/auth-context';
import { useDemo } from '@/state/demo-context';
import { TENANT, TENANT_REWARD_TIERS } from '@/tenant';

import { hapticError, hapticSelection, hapticSuccess } from './rewards/haptics';
import { RewardsHeader, RewardTabs, type RewardTab } from './rewards/header';
import { RewardsTabContent } from './rewards/rewards-tab-content';
import { HelpSheet, PerkSheet, ReferralSheet, RewardSheet } from './rewards/sheets';
import { useRewardStyles } from './rewards/styles';
import type { PerkDetail, RewardDetail } from './rewards/types';
import { useRewardMotion } from './rewards/use-reward-motion';

export function RewardsScreen() {
  const styles = useRewardStyles();
  const { portal, isDemo, refresh } = useAuth();
  const { setClientTab, startOrder } = useAppState();
  const demo = useDemo();
  const [tab, setTab] = useState<RewardTab>('Redeem');
  const [redeeming, setRedeeming] = useState<string | null>(null);
  /**
   * Idempotency keys for in-flight redemptions, keyed by reward id.
   *
   * The key must stay STABLE across retries of one user intent. It previously
   * embedded Date.now(), so every attempt produced a different key -- which
   * silently defeated both the per-user hashing in
   * app/api/mobile/rewards/redeem/route.ts and the UNIQUE constraint on
   * reward_ledger.idempotency_key. A lost response followed by the user tapping
   * again therefore deducted the points twice and issued two entitlements.
   *
   * Generated once per attempt and cleared only after a confirmed success, so a
   * later genuinely-separate redemption of the same reward still gets a fresh key.
   */
  const redemptionKeys = useRef<Record<string, string>>({});
  const [perk, setPerk] = useState<PerkDetail | null>(null);
  const [rewardDetail, setRewardDetail] = useState<RewardDetail | null>(null);
  const [referralOpen, setReferralOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const { width } = useWindowDimensions();
  const compact = width < 360;
  const reducedMotion = useReducedMotion();
  // Demo tier preview. Overriding the year's points is the whole mechanism:
  // the chip, heart palette, earn rate and Status progress all derive from it,
  // so one number moves the entire page to that tier's real state.
  const [tierOverride, setTierOverride] = useState<RewardTierName | null>(null);
  const account = tierOverride
    ? {
        ...portal.rewardAccount,
        annualPoints:
          TENANT_REWARD_TIERS.find((entry) => entry.name === tierOverride)?.minimumAnnualPoints
          ?? portal.rewardAccount.annualPoints,
      }
    : portal.rewardAccount;
  const tier = tierForAnnualPoints(account.annualPoints, TENANT_REWARD_TIERS);
  const { onScroll, reveal, scrollY } = useRewardMotion(tab, reducedMotion);

  async function redeem(reward: RewardCatalogItem) {
    if (reward.pointsCost > portal.rewardAccount.availablePoints) return;
    setRedeeming(reward.id);
    try {
      if (isDemo) {
        demo.redeemReward(reward);
      } else {
        const attemptKey = redemptionKeys.current[reward.id]
          ?? `reward-${reward.id}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
        redemptionKeys.current[reward.id] = attemptKey;
        await mobileApi.redeemReward(reward.id, attemptKey);
        // Only release the key once the server has confirmed; a thrown request
        // keeps it so the retry is recognised as the same intent.
        delete redemptionKeys.current[reward.id];
        await refresh();
      }
      hapticSuccess();
      Alert.alert('Reward ready', `${reward.name} is now available in your account.`);
    } catch (error) {
      hapticError();
      Alert.alert('Redemption unavailable', error instanceof Error ? error.message : 'Try again in a moment.');
    } finally {
      setRedeeming(null);
    }
  }

  async function completeActivity(activityKey: string) {
    if (portal.rewardActivities.includes(activityKey)) return;
    try {
      if (isDemo) {
        demo.completeActivity(activityKey);
      } else {
        await mobileApi.completeRewardActivity(activityKey);
        await refresh();
      }
      hapticSuccess();
      Alert.alert(`${POINTS_LABEL} added`, 'Your balance and annual status are now up to date.');
    } catch (error) {
      hapticError();
      Alert.alert(
        'Verification needed',
        error instanceof Error
          ? error.message
          : 'Complete the qualifying action first, then return here.',
      );
    }
  }

  function changeTab(next: RewardTab) {
    if (next === tab) return;
    hapticSelection();
    setTab(next);
  }

  return (
    <>
      <View style={styles.safeTop}>
      <Screen
        style={styles.screen}
        contentContainerStyle={styles.screenContent}
        accessibilityLabel={`${TENANT.identity.name} rewards`}
        stickyHeaderIndices={[0]}
        onScroll={onScroll}
        scrollEventThrottle={16}
      >
        <View style={styles.stickyNav}>
          <RewardsHeader
            compact={compact}
            tierName={tier.name}
            scrollY={scrollY}
            onHelp={() => {
              hapticSelection();
              setHelpOpen(true);
            }}
          />
          <RewardTabs compact={compact} value={tab} onChange={changeTab} />
        </View>
        <RewardsTabContent
          account={account}
          compact={compact}
          isDemo={isDemo}
          onCompleteActivity={(key) => void completeActivity(key)}
          onReferral={() => setReferralOpen(true)}
          onSelectPerk={setPerk}
          onSelectReward={setRewardDetail}
          onSendGift={() => setClientTab('gift')}
          onTierChange={setTierOverride}
          onUseCash={startOrder}
          portal={portal}
          redeeming={redeeming}
          reducedMotion={reducedMotion}
          reveal={reveal}
          tab={tab}
          tierValue={tier.name}
        />
      </Screen>
      </View>
      <RewardSheet
        detail={rewardDetail}
        onClose={() => setRewardDetail(null)}
        onRedeem={(reward) => {
          setRewardDetail(null);
          void redeem(reward);
        }}
      />
      <PerkSheet perk={perk} onClose={() => setPerk(null)} />
      <ReferralSheet
        open={referralOpen}
        isDemo={isDemo}
        profileId={portal.profile.id}
        onClose={() => setReferralOpen(false)}
      />
      <HelpSheet open={helpOpen} onClose={() => setHelpOpen(false)} />
    </>
  );
}
