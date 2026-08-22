import { Redirect, useLocalSearchParams } from 'expo-router';

import { setPendingReferralCode } from '@/state/pending-referral';

/** Deep link target: coffeestory://refer/<code>. */
export default function ReferralDeepLink() {
  const { code } = useLocalSearchParams<{ code: string }>();
  if (typeof code === 'string') setPendingReferralCode(code);
  return <Redirect href="/client/more/referrals" />;
}
