import { useCallback, useMemo, useState } from 'react';
import {
  Animated,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';

import { Body, PillRow, Screen } from '@/components/ui';
import { CollapsingPageHeader } from '@/components/collapsing-page-header';
import { HeaderIconButton } from '@/components/more-page-header';
import { MoreSearchTakeover } from '@/components/more-search-takeover';
import { buildClientNotifications, projectFirstVariants } from '@platform/domain';
import { searchClientAccount, type ClientSearchResult, type OrderableItem } from '@platform/domain';
import { useFeedVoice } from '@/lib/feed-voice';
import { useAppState, type MoreView } from '@/state/app-context';
import { useAuth } from '@/state/auth-context';
import { useCustomerCatalog } from '@/state/catalog-context';

import { useTokens as useBrandTokens } from '@platform/ui';

import { MoreMenuRows } from './more-menu-rows';

/** Result kind decides the row glyph, the way the web search groups results. */
const SEARCH_SYMBOLS: Record<ClientSearchResult['kind'], 'doc.text' | 'clock.arrow.circlepath' | 'creditcard' | 'heart'> = {
  page: 'doc.text',
  order: 'clock.arrow.circlepath',
  gift: 'creditcard',
  item: 'heart',
};

/**
 * The More tab's root screen -- the menu only.
 *
 * The eleven destinations this used to branch into (items, orders,
 * profile, ...) are now their own pushed routes under `app/client/more/`,
 * each a thin wrapper around the same component this file used to render
 * inline. See that directory for the mapping; `MoreView` (still exported from
 * `state/app-context`) is the shared vocabulary both sides key off.
 */
export function MoreScreen() {
  const tokens = useBrandTokens();
  const {
    openNotifications,
    readNotificationIds,
    openMore,
    startOrder,
  } = useAppState();
  const { portal } = useAuth();
  const { items: menuItems } = useCustomerCatalog();
  const [now] = useState(() => new Date());
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [scrollY] = useState(() => new Animated.Value(0));
  const onScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    scrollY.setValue(event.nativeEvent.contentOffset.y);
  }, [scrollY]);
  const voice = useFeedVoice();
  const notifications = useMemo(() => buildClientNotifications(portal, now, voice), [now, portal, voice]);
  const unreadCount = notifications.filter((item) => !readNotificationIds.has(item.id)).length;

  const orderableItems = useMemo<OrderableItem[]>(() => projectFirstVariants(menuItems), [menuItems]);
  const searchResults = searchClientAccount(query, portal, orderableItems);
  function openResult(result: ClientSearchResult) {
    setSearchOpen(false);
    setQuery('');
    if ('itemId' in result.target) startOrder(result.target.itemId);
    else if (result.target.view === 'book') startOrder();
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
      surfaceColor={tokens.surface}
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

      <MoreMenuRows now={now} />
    </Screen>
    </MoreSearchTakeover>
  );
}
