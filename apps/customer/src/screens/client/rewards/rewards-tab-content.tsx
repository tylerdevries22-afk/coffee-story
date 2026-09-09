import { Animated, Linking, View } from 'react-native';

import type { PortalBundle, RewardAccount, RewardTierName } from '@platform/domain';

import { TENANT } from '@/tenant';
import { hapticSelection } from './haptics';
import type { RewardTab } from './header';
import { useRewardStyles } from './styles';
import { CashTab } from './tabs/cash-tab';
import { EarnTab } from './tabs/earn-tab';
import { RedeemTab } from './tabs/redeem-tab';
import { StatusTab } from './tabs/status-tab';
import type { PerkDetail, RewardDetail } from './types';

type RewardsTabContentProps = {
  account: RewardAccount;
  compact: boolean;
  isDemo: boolean;
  onCompleteActivity: (key: string) => void;
  onReferral: () => void;
  onSelectPerk: (perk: PerkDetail) => void;
  onSelectReward: (detail: RewardDetail) => void;
  onSendGift: () => void;
  onTierChange: (tier: RewardTierName) => void;
  onUseCash: () => void;
  portal: Pick<PortalBundle, 'rewardActivities' | 'rewardCatalog' | 'rewardLedger'>;
  redeeming: string | null;
  reducedMotion: boolean;
  reveal: Animated.Value;
  tab: RewardTab;
  tierValue: RewardTierName;
};

export function RewardsTabContent(props: RewardsTabContentProps) {
  const styles = useRewardStyles();
  const { account, compact, isDemo, portal, redeeming, reducedMotion, reveal, tab } = props;
  return (
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
            onSelect={props.onSelectReward}
          />
        ) : null}
        {tab === 'Status' ? (
          <StatusTab
            account={account}
            onPerk={props.onSelectPerk}
            reducedMotion={reducedMotion}
            isDemo={isDemo}
            tierValue={props.tierValue}
            onTierChange={props.onTierChange}
          />
        ) : null}
        {tab === 'Earn' ? (
          <EarnTab
            isDemo={isDemo}
            completed={portal.rewardActivities}
            onAction={(key) => {
              if (key === 'refer_friend') {
                hapticSelection();
                props.onReferral();
                return;
              }
              props.onCompleteActivity(key);
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
            onUseCash={props.onUseCash}
            onSendGift={props.onSendGift}
          />
        ) : null}
      </Animated.View>
    </View>
  );
}
