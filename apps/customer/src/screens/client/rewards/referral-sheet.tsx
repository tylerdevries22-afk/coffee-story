import { useEffect, useState } from 'react';
import { Alert, Pressable, Share, Text, View } from 'react-native';

import { SheetModal } from '@/components/sheet-modal';
import { POINTS_LABEL, demoReferralCode, referralShareUrl } from '@/features/rewards/presentation';
import { mobileApi } from '@/lib/mobile-api';
import { TENANT } from '@/tenant';
import type { RewardReferral } from '@platform/domain';
import { AppIcon, useTokens as useBrandTokens } from '@platform/ui';

import { hapticError, hapticSuccess } from './haptics';
import { CloseButton } from './sheet-close-button';
import { useRewardStyles } from './styles';

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
  const styles = useRewardStyles();
  const tokens = useBrandTokens();
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
        message: `I think you’ll love ${TENANT.identity.name}. Use my invitation to get started: ${shareUrl}`,
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
        <AppIcon name="square.and.arrow.up" size={24} tintColor={tokens.textPrimary} />
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
