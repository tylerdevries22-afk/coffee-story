import { useCallback, useMemo, useState } from 'react';
import { router } from 'expo-router';
import {
  Alert,
  Animated,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';

import { Body, Button, MoreFooter, PillRow, Screen, SectionTitle } from '@/components/ui';
import { CollapsingPageHeader } from '@/components/collapsing-page-header';
import { HeaderIconButton } from '@/components/more-page-header';
import { MoreSearchTakeover } from '@/components/more-search-takeover';
import { PortalProfileCard } from '@/components/portal-profile-card';
import { BUSINESS } from '@/data/business';
import { SERVICES } from '@/data/catalog';
import { buildClientNotifications } from '@/features/notifications/feed';
import { searchClientAccount, type ClientSearchResult } from '@/features/search/client-search';
import { summarizeGiftCardOwnership } from '@/features/gifts/ownership';
import { useAppState, type MoreView } from '@/state/app-context';
import { tenantFeature } from '@/tenant';
import { useAuth } from '@/state/auth-context';
import { useDemo } from '@/state/demo-context';
import { colors } from '@/theme/tokens';
import type { BookingService } from '@/types/domain';

import { projectFirstServices } from '@/features/booking/service-projections';

import rewardsCup from '../../../assets/tabs/cup.png';

/** Catalog entries in the booking shape the account search expects. */
const BOOKABLE_SERVICES: BookingService[] = projectFirstServices(SERVICES);

/** Result kind decides the row glyph, the way the web search groups results. */
const SEARCH_SYMBOLS: Record<ClientSearchResult['kind'], 'doc.text' | 'clock.arrow.circlepath' | 'creditcard' | 'heart'> = {
  page: 'doc.text',
  visit: 'clock.arrow.circlepath',
  gift: 'creditcard',
  service: 'heart',
};

/**
 * The More tab's root screen -- the menu only.
 *
 * The eleven destinations this used to branch into (services, visits,
 * profile, ...) are now their own pushed routes under `app/client/more/`,
 * each a thin wrapper around the same component this file used to render
 * inline. See that directory for the mapping; `MoreView` (still exported from
 * `state/app-context`) is the shared vocabulary both sides key off.
 */
export function MoreScreen() {
  const {
    openNotifications,
    readNotificationIds,
    openMore,
    setClientTab,
    startBooking,
  } = useAppState();
  const { portal, isDemo, signOut } = useAuth();
  const demo = useDemo();
  const [now] = useState(() => new Date());
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [scrollY] = useState(() => new Animated.Value(0));
  const onScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    scrollY.setValue(event.nativeEvent.contentOffset.y);
  }, [scrollY]);
  const notifications = useMemo(() => buildClientNotifications(portal, now), [now, portal]);
  const unreadCount = notifications.filter((item) => !readNotificationIds.has(item.id)).length;

  const liveOrders = portal.orders ?? [];
  const completedVisits = isDemo
    ? portal.orders.filter((appointment) => appointment.status === 'picked_up').length
    : liveOrders.filter((entry) => entry.status === 'picked_up').length;
  const searchResults = searchClientAccount(query, portal, BOOKABLE_SERVICES);
  const giftSummary = summarizeGiftCardOwnership(portal.giftCards);
  const giftBalanceCents = isDemo ? giftSummary.spendableBalanceCents : portal.rewardAccount.cashCents;
  const upcomingVisits = isDemo
    ? portal.orders.filter((appointment) => (
      (appointment.status === 'paid' || appointment.status === 'created')
      && new Date(appointment.placedAt).getTime() > now.getTime()
    )).length
    : liveOrders.filter((entry) => ['created', 'paid', 'in_progress', 'ready'].includes(entry.status)).length;
  const clientMetrics = [
    { label: 'Upcoming', value: String(upcomingVisits) },
    { label: 'Gift balance', value: `$${(giftBalanceCents / 100).toFixed(2)}` },
    { label: 'Beans', value: portal.rewardAccount.availablePoints.toLocaleString('en-US') },
  ] as const;
  function openResult(result: ClientSearchResult) {
    setSearchOpen(false);
    setQuery('');
    if ('serviceId' in result.target) startBooking(result.target.serviceId);
    else if (result.target.view === 'book') startBooking();
    else openMore(result.target.view as MoreView);
  }

  return (
    <MoreSearchTakeover
      searching={searchOpen}
      onClose={() => {
        setSearchOpen(false);
        setQuery('');
      }}
      query={query}
      onQueryChange={setQuery}
      placeholder="Orders, gift cards, menu…"
      accessibilityLabel="Search your account"
      surfaceColor={colors.surface}
      results={(
        <Screen keyboardShouldPersistTaps="handled">
          {!query.trim() ? <Body muted>Search your orders, gift cards, menu and account pages.</Body> : null}
          {query.trim() && !searchResults.length ? <Body muted>Nothing matches “{query.trim()}”.</Body> : null}
          {searchResults.map((result) => (
            <PillRow
              key={result.id}
              title={result.title}
              subtitle={result.detail}
              symbol={SEARCH_SYMBOLS[result.kind]}
              onPress={() => openResult(result)}
            />
          ))}
        </Screen>
      )}
    >
    <Screen
      stickyHeaderIndices={[0]}
      contentContainerStyle={{ paddingTop: 0 }}
      onScroll={onScroll}
      scrollEventThrottle={16}
    >
      <CollapsingPageHeader
        title="Profile"
        scrollY={scrollY}
        actions={(
          <>
            <HeaderIconButton
              label="Search your account"
              symbol="magnifyingglass"
              onPress={() => setSearchOpen(true)}
            />
            <HeaderIconButton
              label="Notifications"
              symbol="bell"
              badge={unreadCount}
              onPress={() => openNotifications(notifications.map((item) => item.id))}
            />
          </>
        )}
      />

      <PortalProfileCard
        name={portal.profile.fullName || 'Member'}
        avatarUrl={portal.profile.avatarUrl}
        roleLabel="Coffee Legend member"
        previewLabel={isDemo ? 'Client preview' : 'Live account'}
        metrics={clientMetrics}
        profileLabel="Open account settings"
        onProfile={() => openMore('profile')}
      />

      <SectionTitle>General</SectionTitle>
      <PillRow
        title="Menu & pricing"
        subtitle="Every drink, size, and extra"
        symbol="heart"
        onPress={() => openMore('services')}
      />
      <PillRow title="Shop location & hours" subtitle={`${BUSINESS.street}, ${BUSINESS.cityLine}`} symbol="calendar" onPress={() => openMore('location')} />
      <PillRow title="Our story & brewing guides" symbol="doc.text" onPress={() => openMore('resources')} />
      {tenantFeature('drops') ? (
        <PillRow title="Drops" subtitle="Limited runs, past and present" symbol="clock.arrow.circlepath" onPress={() => openMore('drops')} />
      ) : null}
      {tenantFeature('catering') ? (
        <PillRow title="Catering" subtitle="Carafes and pastry boxes for events" symbol="calendar" onPress={() => openMore('catering')} />
      ) : null}
      {tenantFeature('referrals') ? (
        <PillRow title="Refer a friend" subtitle="A free drink for you both" symbol="heart" onPress={() => openMore('referrals')} />
      ) : null}
      {/* Domains the live plane does not serve yet stay demo-only: the live
          bundle omits their keys, so these rows only render with data behind
          them. */}
      {portal.intake !== undefined ? (
        <PillRow title="My usual & preferences" subtitle={portal.intake?.completed ? 'Saved' : 'Needs attention'} symbol="doc.text" onPress={() => openMore('intake')} />
      ) : null}
      {portal.membership !== undefined ? (
        <PillRow title="Membership" subtitle={portal.membership?.name ?? 'Explore plans'} symbol="heart" onPress={() => openMore('membership')} />
      ) : null}

      <SectionTitle>My account</SectionTitle>
      <PillRow
        title="My Rewards"
        subtitle={`${portal.rewardAccount.availablePoints.toLocaleString('en-US')} Beans`}
        iconSrc={rewardsCup}
        onPress={() => setClientTab('rewards')}
      />
      <PillRow title="Account settings" subtitle={portal.profile.fullName} symbol="person.crop.circle" onPress={() => openMore('profile')} />
      {isDemo || portal.giftCards.length > 0 ? (
        <PillRow
          title="Gift card balance"
          subtitle={`$${(giftSummary.spendableBalanceCents / 100).toFixed(2)} available · ${giftSummary.sentCards.length} sent`}
          symbol="creditcard"
          onPress={() => openMore('gift-balance')}
        />
      ) : null}
      <PillRow title="Orders & pickup history" subtitle={`${completedVisits} completed orders`} symbol="clock.arrow.circlepath" onPress={() => openMore('visits')} />
      {portal.paymentMethods !== undefined ? (
        <PillRow title="Payment methods" subtitle={`${portal.paymentMethods.length} saved`} symbol="creditcard" onPress={() => openMore('payments')} />
      ) : null}
      {portal.messages !== undefined ? (
        <PillRow title="Messages" subtitle={`${portal.messages.filter((message) => !message.read).length} unread`} symbol="message" onPress={() => openMore('messages')} />
      ) : null}

      <SectionTitle>Support</SectionTitle>
      <PillRow title="Frequently asked questions" onPress={() => openMore('faq')} />
      <PillRow title="Order & refund policy" onPress={() => openMore('care-policy')} />

      {isDemo ? (
        <>
          <Button label="Reset demo data" variant="secondary" onPress={() => {
            Alert.alert('Reset demo?', 'Bookings, gifts, messages, and account edits will return to their original preview state.', [
              { text: 'Keep changes', style: 'cancel' },
              { text: 'Reset', style: 'destructive', onPress: () => void demo.resetDemo() },
            ]);
          }} />
          {/* Demo mode had no exit. `chooseLive` existed on the context and had
              no call site anywhere, so once a build was in Demo -- which was
              every build -- there was no way to reach the sign-in screen. */}
          {demo.canGoLive ? (
            <Button
              label="Sign in to your account"
              variant="secondary"
              // Replacing back to the root is what actually shows the sign-in
              // screen: `app/index.tsx` is the app's only auth gate and it
              // unmounted when it redirected into these tabs, so flipping the
              // mode alone left the guest inside the shell against an empty
              // portal.
              onPress={() => {
                void demo.chooseLive().then(() => router.replace('/'));
              }}
            />
          ) : null}
        </>
      ) : (
        <>
          <Button label="Switch to Demo" variant="secondary" onPress={() => void demo.chooseDemo()} />
          <Button label="Sign out" variant="secondary" onPress={() => void signOut()} />
        </>
      )}

      {/* Footer, laid out like the reference: two legal pills side by side,
          then the version pill with the brand mark beneath them. */}
      <MoreFooter
        onPrivacy={() => openMore('privacy')}
        onTerms={() => openMore('privacy')}
        version="Coffee Story 1.0"
        caption={isDemo ? 'Explicit Demo mode · changes are saved on this device' : 'Connected securely to live services'}
        iconSrc={rewardsCup}
      />
    </Screen>
    </MoreSearchTakeover>
  );
}
