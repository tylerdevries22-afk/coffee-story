import { createElement, useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, Share, Text, View } from 'react-native';

import { AppIcon } from '@/components/icon';
import { SheetModal } from '@/components/sheet-modal';
import { Button } from '@/components/ui';
import { POINTS_LABEL, demoReferralCode, referralShareUrl } from '@/features/rewards/presentation';
import { mobileApi } from '@/lib/mobile-api';
import { TENANT } from '@/tenant';
import { colors } from '@/theme/tokens';
import type { RewardCatalogItem, RewardReferral } from '@platform/domain';

import { hapticError, hapticSuccess } from './haptics';
import { RewardMark } from './reward-mark';
import { styles } from './styles';
import type { PerkDetail, RewardDetail } from './types';

/**
 * The Rewards tab's modal sheets: perk detail, reward detail, the referral
 * share sheet and the help sheet. Split out of rewards-screen because they are
 * self-contained -- each takes its subject plus an onClose and renders a sheet
 * -- and together they were a fifth of a 1,465-line file.
 *
 * Presentation and motion belong to `SheetModal`; these only describe content.
 * Reduced motion is read there too, which is why none of them take it as a
 * prop any more.
 */
export function PerkSheet({ perk, onClose }: { perk: PerkDetail | null; onClose: () => void }) {
  if (!perk) return null;
  return (
    <SheetModal
      visible
      onRequestClose={onClose}
      dismissLabel="Close perk details"
      sheetStyle={styles.perkSheet}
    >
      <View style={styles.sheetTop}>
        <View style={styles.sheetBadges}>
          <View style={styles.sheetTierBadge}><Text style={styles.sheetTierText}>{perk?.tier}</Text></View>
          {perk?.locked ? (
            <View style={styles.lockedBadge}>
              <AppIcon name="lock.fill" size={17} tintColor={colors.ink400} />
              <Text style={styles.lockedBadgeText}>Locked</Text>
            </View>
          ) : null}
        </View>
        <CloseButton onPress={onClose} />
      </View>
      <Text style={styles.sheetTitle}>{perk?.label}</Text>
      <Text style={styles.sheetBody}>{perk?.description}</Text>
      <View style={styles.sheetSpacer} />
      <Button label="Done" onPress={onClose} />
    </SheetModal>
  );
}

export function RewardSheet({
  detail,
  onClose,
  onRedeem,
}: {
  detail: RewardDetail | null;
  onClose: () => void;
  onRedeem: (reward: RewardCatalogItem) => void;
}) {
  if (!detail) return null;
  return (
    <SheetModal
      visible
      onRequestClose={onClose}
      dismissLabel="Close reward details"
      sheetStyle={styles.perkSheet}
    >
      <View style={styles.sheetTop}>
        <View style={styles.sheetBadges}>
          <View style={styles.sheetTierBadge}>
            <Text style={styles.sheetTierText}>
              {detail?.reward.pointsCost.toLocaleString()} {POINTS_LABEL}
            </Text>
          </View>
          {detail?.locked ? (
            <View style={styles.lockedBadge}>
              <AppIcon name="lock.fill" size={17} tintColor={colors.ink400} />
              <Text style={styles.lockedBadgeText}>Locked</Text>
            </View>
          ) : null}
        </View>
        <CloseButton onPress={onClose} />
      </View>
      <Text style={styles.sheetTitle}>{detail?.reward.name}</Text>
      <Text style={styles.sheetBody}>
        {detail?.reward.description ?? 'Apply this reward to an eligible Coffee Story order.'}
      </Text>
      {detail?.locked ? (
        <View style={styles.referralEmpty}>
          <Text style={styles.referralEmptyText}>
            Keep earning {POINTS_LABEL} to unlock this reward.
          </Text>
        </View>
      ) : null}
      <View style={styles.sheetSpacer} />
      <Button
        label={detail?.locked ? 'Done' : 'Redeem reward'}
        onPress={() => {
          if (detail && !detail.locked) {
            onRedeem(detail.reward);
            return;
          }
          onClose();
        }}
      />
    </SheetModal>
  );
}

export function ReferralSheet({
  open,
  isDemo,
  profileId,
  onClose,
}: {
  open: boolean;
  isDemo: boolean;
  profileId: string;
  onClose: () => void;
}) {
  const demoCode = demoReferralCode(profileId);
  const [code, setCode] = useState(demoCode);
  const [shareUrl, setShareUrl] = useState(referralShareUrl(TENANT.business.website, demoCode));
  const [referrals, setReferrals] = useState<RewardReferral[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || isDemo) return;
    const timer = setTimeout(() => {
      setLoading(true);
      void mobileApi.rewardReferral()
        .then((payload) => {
          setCode(payload.code);
          setShareUrl(payload.shareUrl);
          setReferrals(payload.referrals);
        })
        .catch((error) => {
          Alert.alert('Referral link unavailable', error instanceof Error ? error.message : 'Try again in a moment.');
        })
        .finally(() => setLoading(false));
    }, 0);
    return () => clearTimeout(timer);
  }, [isDemo, open]);

  if (!open) return null;

  async function shareReferral() {
    try {
      await Share.share({
        title: 'A little care, shared',
        message: `I think you’ll love Coffee Story. Use my invitation to get started: ${shareUrl}`,
        url: shareUrl,
      });
      hapticSuccess();
    } catch {
      hapticError();
      Alert.alert('Could not open sharing', 'Copy the invitation link and try again.');
    }
  }

  return (
    <SheetModal
      visible
      onRequestClose={onClose}
      dismissLabel="Close referral sheet"
      sheetStyle={styles.referralSheet}
    >
      <View style={styles.sheetTop}>
        <View style={styles.referralPointsBadge}><Text style={styles.referralPointsText}>+20 {POINTS_LABEL}</Text></View>
        <CloseButton onPress={onClose} />
      </View>
      <Text style={styles.referralTitle}>Refer a Friend</Text>
      <Text style={styles.referralBody}>
        Share the invitation below. You’ll receive 20 {POINTS_LABEL} after your friend joins and places their first eligible order.
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Share referral code ${code}`}
        disabled={loading}
        onPress={() => void shareReferral()}
        style={({ pressed }) => [styles.referralLinkCard, pressed && styles.rowPressed]}
      >
        <Text numberOfLines={1} style={styles.referralLink}>{loading ? 'Preparing your invitation…' : shareUrl}</Text>
        <AppIcon name="square.and.arrow.up" size={24} tintColor={colors.ink900} />
      </Pressable>
      <Text style={styles.referralFootnote}>New guests only. Beans are awarded after the first completed, paid order.</Text>
      <View style={styles.referralDivider} />
      <Text style={styles.referralPendingTitle}>Pending Referrals ({referrals.filter((item) => item.status === 'pending').length})</Text>
      {referrals.length ? referrals.map((referral) => (
        <View key={referral.id} style={styles.pendingReferral}>
          <Text style={styles.pendingReferralCode}>{referral.referralCode}</Text>
          <Text style={styles.pendingReferralStatus}>{referral.status}</Text>
        </View>
      )) : (
        <View style={styles.referralEmpty}><Text style={styles.referralEmptyText}>No pending referrals</Text></View>
      )}
    </SheetModal>
  );
}

export function HelpSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;
  return (
    <SheetModal
      visible
      onRequestClose={onClose}
      dismissLabel="Close rewards help"
      sheetStyle={styles.helpSheet}
    >
      {createElement(
        ScrollView,
        {
          style: styles.helpScroll,
          contentContainerStyle: styles.helpScrollContent,
          showsVerticalScrollIndicator: false,
        },
        [
          <View key="header" style={styles.sheetTop}>
            <RewardMark />
            <CloseButton onPress={onClose} />
          </View>,
          <Text key="title" style={styles.sheetTitle}>Care that gives back.</Text>,
          <Text key="body" style={styles.sheetBody}>
            Earn {POINTS_LABEL} on eligible purchases, unlock status perks, redeem drink rewards, and keep Brew Bucks ready for your next order.
          </Text>,
          <View key="earn" style={styles.helpRule}><Text style={styles.helpRuleTitle}>Earn</Text><Text style={styles.helpRuleBody}>10–13 points per eligible $1, based on status.</Text></View>,
          <View key="redeem" style={styles.helpRule}><Text style={styles.helpRuleTitle}>Redeem</Text><Text style={styles.helpRuleBody}>Choose unlocked rewards directly from the Redeem tab.</Text></View>,
          <View key="expire" style={styles.helpRule}><Text style={styles.helpRuleTitle}>Expire</Text><Text style={styles.helpRuleBody}>Points expire 12 months after they are earned.</Text></View>,
        ],
      )}
      <Button
        label="Got it"
        onPress={onClose}
        style={styles.helpDoneButton}
        testID="rewards-help-done"
      />
    </SheetModal>
  );
}

function CloseButton({ onPress }: { onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Close"
      hitSlop={8}
      onPress={onPress}
      style={({ pressed }) => [styles.closeButton, pressed && styles.pressed]}
    >
      <AppIcon name="xmark" size={25} tintColor={colors.ink900} weight="medium" />
    </Pressable>
  );
}

export function perkDescription(label: string): string {
  if (label.includes('priority')) {
    return 'Save 5% and skip the line with priority pickup during select early-access windows. Eligible windows are shown before checkout.';
  }
  if (label.includes('Birthday')) {
    return 'Enjoy a birthday drink on us during your birthday month. A birthday must be saved to your profile before the month begins.';
  }
  if (label.includes('size upgrade')) {
    return 'Order any size, pay for the smaller one — one free upgrade per eligible order.';
  }
  return 'Receive thoughtful offers selected for your current Coffee Story rewards status.';
}
