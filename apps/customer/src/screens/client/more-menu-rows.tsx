import { router } from 'expo-router';
import { Alert } from 'react-native';

import { Button, MoreFooter, PillRow, SectionTitle } from '@/components/ui';
import { PortalProfileCard } from '@/components/portal-profile-card';
import { BUSINESS } from '@/data/business';
import { summarizeGiftCardOwnership } from '@/features/gifts/ownership';
import { useAppState } from '@/state/app-context';
import { useAuth } from '@/state/auth-context';
import { useDemo } from '@/state/demo-context';
import { TENANT, TENANT_REWARD_TIERS, tenantFeature } from '@/tenant';
import { tierForAnnualPoints } from '@platform/domain';
import { useCopy } from '@platform/ui';

import rewardsCup from '../../../assets/tabs/cup.png';

export function MoreMenuRows({ now }: { now: Date }) {
  const { openMore, setClientTab } = useAppState();
  const { portal, isDemo, signOut } = useAuth();
  const demo = useDemo();
  const pointsName = useCopy()('pointsName');
  const liveOrders = portal.orders ?? [];
  const completedOrders = isDemo
    ? portal.orders.filter((order) => order.status === 'picked_up').length
    : liveOrders.filter((entry) => entry.status === 'picked_up').length;
  const giftSummary = summarizeGiftCardOwnership(portal.giftCards);
  const giftBalanceCents = isDemo ? giftSummary.spendableBalanceCents : portal.rewardAccount.cashCents;
  const upcomingVisits = isDemo
    ? portal.orders.filter((order) => (
      (order.status === 'paid' || order.status === 'created')
      && new Date(order.placedAt).getTime() > now.getTime()
    )).length
    : liveOrders.filter((entry) => ['created', 'paid', 'in_progress', 'ready'].includes(entry.status)).length;
  const clientMetrics = [
    { label: 'Upcoming', value: String(upcomingVisits) },
    { label: 'Gift balance', value: `$${(giftBalanceCents / 100).toFixed(2)}` },
    { label: pointsName, value: portal.rewardAccount.availablePoints.toLocaleString('en-US') },
  ] as const;
  return (
    <>
      <PortalProfileCard
        name={portal.profile.fullName || 'Member'}
        avatarUrl={portal.profile.avatarUrl}
        roleLabel={`${tierForAnnualPoints(portal.rewardAccount.annualPoints, TENANT_REWARD_TIERS).name} member`}
        previewLabel={isDemo ? 'Client preview' : 'Live account'}
        metrics={clientMetrics}
        profileLabel="Open account settings"
        onProfile={() => openMore('profile')}
      />
      <SectionTitle>General</SectionTitle>
      <PillRow title="Catalog & pricing" subtitle="Every item, option, and extra" symbol="heart" onPress={() => openMore('menu-prices')} />
      <PillRow title="Location & hours" subtitle={`${BUSINESS.street}, ${BUSINESS.cityLine}`} symbol="calendar" onPress={() => openMore('location')} />
      <PillRow title="Guides & resources" symbol="doc.text" onPress={() => openMore('resources')} />
      {tenantFeature('drops') ? <PillRow title="Drops" subtitle="Limited runs, past and present" symbol="clock.arrow.circlepath" onPress={() => openMore('drops')} /> : null}
      {tenantFeature('catering') ? <PillRow title="Catering" subtitle="Event service and group options" symbol="calendar" onPress={() => openMore('catering')} /> : null}
      {tenantFeature('referrals') ? <PillRow title="Refer a friend" subtitle="A reward for you both" symbol="heart" onPress={() => openMore('referrals')} /> : null}
      {portal.preferences !== undefined ? (
        <PillRow title="My usual & preferences" subtitle={portal.preferences?.completed ? 'Saved' : 'Needs attention'} symbol="doc.text" onPress={() => openMore('preferences')} />
      ) : null}
      {portal.membership !== undefined ? (
        <PillRow title="Membership" subtitle={portal.membership?.name ?? 'Explore plans'} symbol="heart" onPress={() => openMore('membership')} />
      ) : null}
      <SectionTitle>My account</SectionTitle>
      <PillRow title="My Rewards" subtitle={`${portal.rewardAccount.availablePoints.toLocaleString('en-US')} ${pointsName}`} iconSrc={rewardsCup} onPress={() => setClientTab('rewards')} />
      <PillRow title="Account settings" subtitle={portal.profile.fullName} symbol="person.crop.circle" onPress={() => openMore('profile')} />
      {isDemo || portal.giftCards.length > 0 ? (
        <PillRow title="Gift card balance" subtitle={`$${(giftSummary.spendableBalanceCents / 100).toFixed(2)} available · ${giftSummary.sentCards.length} sent`} symbol="creditcard" onPress={() => openMore('gift-balance')} />
      ) : null}
      <PillRow title="Orders & pickup history" subtitle={`${completedOrders} completed orders`} symbol="clock.arrow.circlepath" onPress={() => openMore('orders')} />
      {portal.paymentMethods !== undefined ? (
        <PillRow title="Payment methods" subtitle={`${portal.paymentMethods.length} saved`} symbol="creditcard" onPress={() => openMore('payments')} />
      ) : null}
      {portal.messages !== undefined ? (
        <PillRow title="Messages" subtitle={`${portal.messages.filter((message) => !message.read).length} unread`} symbol="message" onPress={() => openMore('messages')} />
      ) : null}
      <SectionTitle>Support</SectionTitle>
      <PillRow title="Frequently asked questions" onPress={() => openMore('faq')} />
      <PillRow title="Order & refund policy" onPress={() => openMore('order-policy')} />
      {accountActions()}
      <MoreFooter
        onPrivacy={() => openMore('privacy')}
        onTerms={() => openMore('privacy')}
        version={`${TENANT.identity.name} 1.0`}
        caption={isDemo ? 'Explicit Demo mode · changes are saved on this device' : 'Connected securely to live items'}
        iconSrc={rewardsCup}
      />
    </>
  );

  function accountActions() {
    if (!isDemo) {
      return (
        <>
          <Button label="Switch to Demo" variant="secondary" onPress={() => void demo.chooseDemo()} />
          <Button label="Sign out" variant="secondary" onPress={() => void signOut()} />
        </>
      );
    }
    return (
      <>
        <Button label="Reset demo data" variant="secondary" onPress={() => {
          Alert.alert('Reset demo?', 'Bookings, gifts, messages, and account edits will return to their original preview state.', [
            { text: 'Keep changes', style: 'cancel' },
            { text: 'Reset', style: 'destructive', onPress: () => void demo.resetDemo() },
          ]);
        }} />
        {demo.canGoLive ? (
          <Button label="Sign in to your account" variant="secondary" onPress={() => {
            void demo.chooseLive().then(() => router.replace('/'));
          }} />
        ) : null}
      </>
    );
  }
}
