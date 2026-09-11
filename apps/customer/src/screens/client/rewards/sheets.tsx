import { createElement } from 'react';
import { ScrollView, Text, View } from 'react-native';

import { SheetModal } from '@/components/sheet-modal';
import { Button } from '@/components/ui';
import { POINTS_LABEL } from '@/features/rewards/presentation';
import { TENANT } from '@/tenant';
import type { RewardCatalogItem } from '@platform/domain';

import { RewardMark } from './reward-mark';
import { CloseButton } from './sheet-close-button';
import { useRewardStyles } from './styles';
import type { PerkDetail, RewardDetail } from './types';
import { useTokens as useBrandTokens, AppIcon } from '@platform/ui';

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
  const styles = useRewardStyles();
  const tokens = useBrandTokens();
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
              <AppIcon name="lock.fill" size={17} tintColor={tokens.textMuted} />
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
  const styles = useRewardStyles();
  const tokens = useBrandTokens();
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
              <AppIcon name="lock.fill" size={17} tintColor={tokens.textMuted} />
              <Text style={styles.lockedBadgeText}>Locked</Text>
            </View>
          ) : null}
        </View>
        <CloseButton onPress={onClose} />
      </View>
      <Text style={styles.sheetTitle}>{detail?.reward.name}</Text>
      <Text style={styles.sheetBody}>
        {detail?.reward.description ?? `Apply this reward to an eligible ${TENANT.identity.name} order.`}
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

export function HelpSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const styles = useRewardStyles();
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
  return `Receive thoughtful offers selected for your current ${TENANT.identity.name} rewards status.`;
}

export { ReferralSheet } from './referral-sheet';
