import {
  useEffect,
  useCallback,
  useRef,
  useState,
} from 'react';
import {
  Alert,
  Animated,
  Linking,
  View,
  useWindowDimensions,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';

import { Screen } from '@/components/ui';
import { POINTS_LABEL } from '@/features/rewards/presentation';
import { useReducedMotion } from '@platform/ui';
import { tierForAnnualPoints, REWARD_TIERS, type RewardTierName , RewardCatalogItem } from '@platform/domain';
import { mobileApi } from '@/lib/mobile-api';
import { useAppState } from '@/state/app-context';
import { useAuth } from '@/state/auth-context';
import { useDemo } from '@/state/demo-context';
import { TENANT } from '@/tenant';

import { hapticError, hapticSelection, hapticSuccess } from './rewards/haptics';
import { RewardsHeader, RewardTabs, type RewardTab } from './rewards/header';
import { EarnTab } from './rewards/tabs/earn-tab';
import { CashTab } from './rewards/tabs/cash-tab';
import { RedeemTab } from './rewards/tabs/redeem-tab';
import { StatusTab } from './rewards/tabs/status-tab';
import { HelpSheet, PerkSheet, ReferralSheet, RewardSheet } from './rewards/sheets';
import { useRewardStyles } from './rewards/styles';
import type { PerkDetail, RewardDetail } from './rewards/types';

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
          REWARD_TIERS.find((entry) => entry.name === tierOverride)?.minimumAnnualPoints
          ?? portal.rewardAccount.annualPoints,
      }
    : portal.rewardAccount;
  const tier = tierForAnnualPoints(account.annualPoints);
  const [reveal] = useState(() => new Animated.Value(1));
  const [scrollY] = useState(() => new Animated.Value(0));
  const onScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    scrollY.setValue(event.nativeEvent.contentOffset.y);
  }, [scrollY]);

  useEffect(() => {
    if (reducedMotion) {
      reveal.setValue(1);
      return;
    }
    reveal.setValue(0);
    Animated.spring(reveal, {
      toValue: 1,
      damping: 18,
      stiffness: 180,
      mass: 0.8,
      useNativeDriver: true,
    }).start();
  }, [reducedMotion, reveal, tab]);

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
        <View style={styles.whiteBody}>
          <Animated.View
            style={[
              styles.tabContent,
              compact && styles.tabContentCompact,
              {
                opacity: reveal,
                transform: [{
                  translateY: reveal.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }),
                }],
              },
            ]}
          >
            {tab === 'Redeem' ? (
              <RedeemTab
                account={account}
                catalog={portal.rewardCatalog}
                redeeming={redeeming}
                reducedMotion={reducedMotion}
                onSelect={setRewardDetail}
              />
            ) : null}
            {tab === 'Status' ? (
              <StatusTab
                account={account}
                onPerk={setPerk}
                reducedMotion={reducedMotion}
                isDemo={isDemo}
                tierValue={tier.name}
                onTierChange={setTierOverride}
              />
            ) : null}
            {tab === 'Earn' ? (
              <EarnTab
                isDemo={isDemo}
                completed={portal.rewardActivities}
                onAction={(key) => {
                  if (key === 'refer_friend') {
                    hapticSelection();
                    setReferralOpen(true);
                    return;
                  }
                  void completeActivity(key);
                }}
                onGoogleReview={() => {
                  const place = `${TENANT.identity.name} ${TENANT.location.address.city} ${TENANT.location.address.region} reviews`;
                  void Linking.openURL(`https://www.google.com/search?q=${encodeURIComponent(place)}`);
                }}
              />
            ) : null}
            {tab === 'Cash' ? (
              <CashTab
                account={account}
                ledger={portal.rewardLedger}
                onUseCash={startOrder}
                onSendGift={() => setClientTab('gift')}
              />
            ) : null}
          </Animated.View>
        </View>
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
