import * as Haptics from 'expo-haptics';
import { useMemo, useState } from 'react';
import { Alert, Animated, Pressable, StyleSheet, Text, View } from 'react-native';

import { CollapsingPageHeader } from '@/components/collapsing-page-header';
import { HeaderIconButton } from '@/components/more-page-header';
import { MoreSearchTakeover } from '@/components/more-search-takeover';
import { PortalProfileCard } from '@/components/portal-profile-card';
import { PreviewRolePicker } from '@/components/preview-role-picker';
import { SetupProgressCard } from '@/components/setup/setup-progress-card';
import { Body, Card, MoreFooter, PillRow, Screen, SectionTitle } from '@/components/ui';
import {
  adminNavigationGroupsForRole,
  searchAdminWorkspace,
  type AdminSearchResult,
} from '@/features/admin/admin-navigation';
import { buildStaffNotifications } from '@platform/domain';
import { portalSetup } from '@/features/setup/setup';
import { workspaceTone } from '@/features/staff/workspace';
import { openWebPath } from '@/lib/web-navigation';
import { useAppState } from '@/state/app-context';
import { useAuth } from '@/state/auth-context';
import { useBusiness } from '@/state/business';
import type { PortalOrder, StaffDashboard } from '@platform/domain';
import { AppIcon } from '@/components/icon';
import { Profile } from '@/screens/staff/profile';

import rewardsCup from '../../../assets/tabs/cup.png';
import { useTokens as useBrandTokens, type BrandTokens } from '@platform/ui';

type HeaderSurface = 'profile' | null;

export function AdminMoreScreen({ dashboard }: { dashboard: StaffDashboard }) {
  const tokens = useBrandTokens();
  const styles = createStyles(tokens);
  const {
    exitStaff,
    openNotifications,
    openStaffDestination,
    queueSetupPrompt,
    readNotificationIds,
    selectRole,
  } = useAppState();
  const { isDemo, portal, role, signOut } = useAuth();
  const business = useBusiness();
  const [surface, setSurface] = useState<HeaderSurface>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [scrollY] = useState(() => new Animated.Value(0));
  const groups = adminNavigationGroupsForRole(role);
  const configurationGroup = groups.find((group) => group.title === 'Configuration');
  const secondaryGroups = groups.filter((group) => group.title !== 'Configuration');
  const notifications = useMemo(() => buildStaffNotifications(dashboard, new Date()), [dashboard]);
  const unreadCount = notifications.filter((item) => !readNotificationIds.has(item.id)).length;
  const profileMetrics = [
    { label: 'Revenue', value: `$${Math.round(dashboard.projectedCents / 100)}` },
    { label: 'Appts today', value: String(countToday(dashboard.orders)) },
    { label: 'Open hours', value: `${Math.round(dashboard.openMinutes / 60)}h` },
  ] as const;
  const setup = portalSetup(portal)[role];
  const searchResults = useMemo(
    () => searchAdminWorkspace(query, role, dashboard.clients),
    [dashboard.clients, query, role],
  );

  function openDestination(path: string) {
    setSurface(null);
    setQuery('');
    openStaffDestination(path);
  }

  function toggleSurface(next: Exclude<HeaderSurface, null>) {
    setSurface((current) => (current === next ? null : next));
    void Haptics.selectionAsync();
  }

  if (surface === 'profile') {
    return (
      <Profile
        onBack={() => setSurface(null)}
        onExit={exitStaff}
        onSignOut={!isDemo ? () => void signOut().catch((error: unknown) => {
          Alert.alert('Sign out failed', error instanceof Error ? error.message : 'Try again.');
        }) : undefined}
      />
    );
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
      placeholder="Guests, schedule, reports…"
      accessibilityLabel="Search guests and administration"
      surfaceColor={role === 'admin' ? tokens.primary : tokens.secondary}
      results={(
        <WorkspaceSearchResults
          tone={workspaceTone(role)}
          query={query}
          results={searchResults}
          onResult={(result) => {
            setSearchOpen(false);
            setQuery('');
            openDestination(result.path);
          }}
        />
      )}
    >
    {/* Plum, matching the web admin drawer. Owner and staff each get their own
        shade so the two workspaces read apart; the client More page stays light. */}
    <Screen
      tone={workspaceTone(role)}
      keyboardShouldPersistTaps="handled"
      stickyHeaderIndices={[0]}
      contentContainerStyle={{ paddingTop: 0 }}
      onScroll={(event) => scrollY.setValue(event.nativeEvent.contentOffset.y)}
      scrollEventThrottle={16}
    >
      <CollapsingPageHeader
        title="More"
        scrollY={scrollY}
        backgroundColor={role === 'admin' ? tokens.surface : tokens.surface}
        actions={(
          <>
            <HeaderIconButton
              label="Search workspace"
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

      {isDemo ? <PreviewRolePicker role={role} onChange={selectRole} /> : null}
      <PortalProfileCard
        name={portal.profile.fullName || 'Pharin J.'}
        avatarUrl={portal.profile.avatarUrl}
        roleLabel={role === 'admin' ? 'Owner' : 'Team member'}
        previewLabel={isDemo ? `${role} preview` : 'Live workspace'}
        metrics={profileMetrics}
        profileLabel="Open staff profile"
        onProfile={() => toggleSurface('profile')}
        settingsLabel="Business settings"
        onSettings={() => openDestination('/admin/settings')}
      />
      {isDemo ? <SetupProgressCard setup={setup} onPress={() => queueSetupPrompt(role)} /> : null}

      <View style={styles.group}>
        <SectionTitle>My account</SectionTitle>
        <PillRow
          title="My Rewards"
          subtitle="Tiers, earning rules, points, and expiry"
          iconSrc={rewardsCup}
          onPress={() => openDestination('/admin/rewards')}
        />
        <PillRow
          title="Account settings"
          subtitle={portal.profile.fullName}
          symbol="person.crop.circle"
          onPress={() => toggleSurface('profile')}
        />
        <PillRow
          title="Messages"
          subtitle="Guest conversations"
          symbol="message"
          onPress={() => openDestination('/admin/clients')}
        />
      </View>

      {secondaryGroups.map((group) => (
        <View key={group.title} style={styles.group}>
          <SectionTitle>{group.title}</SectionTitle>
          {(group.title === 'Operations' && configurationGroup
            ? [...configurationGroup.destinations, ...group.destinations]
            : group.destinations
          ).map((destination) => (
            <PillRow
              key={destination.path}
              title={destination.title}
              subtitle={destinationDescription(destination.path)}
              symbol={destinationSymbol(destination.path)}
              onPress={() => openDestination(destination.path)}
            />
          ))}
        </View>
      ))}
      {/* The proposal is a shortcut, not a section: a heading over a single
          card said less than the card already does. */}
      <Card style={styles.proposalCard}>
        <View style={styles.proposalIcon}><AppIcon name="doc.text" size={20} tintColor={tokens.primary} /></View>
        <View style={styles.proposalCopy}>
          <Text style={styles.proposalTitle}>Website Proposal</Text>
          <Text style={styles.proposalDetail}>Approved scope and launch handoff.</Text>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel="Open Website Proposal" onPress={() => openDestination('/proposal')} style={({ pressed }) => [styles.roundButton, pressed && styles.pressed]}>
          <AppIcon name="chevron.right" size={16} tintColor={tokens.primary} />
        </Pressable>
      </Card>
      <MoreFooter
        onPrivacy={() => void openWebPath('/privacy')}
        onTerms={() => void openWebPath('/privacy')}
        version={`${business.name} 1.0`}
        caption={isDemo ? 'Explicit Demo mode · changes are saved on this device' : 'Connected securely to live services'}
        iconSrc={rewardsCup}
      />
    </Screen>
    </MoreSearchTakeover>
  );
}

function countToday(orders: readonly PortalOrder[]): number {
  const today = new Date().toDateString();
  return orders.filter((order) => new Date(order.placedAt).toDateString() === today).length;
}

/**
 * The whole search page: results fill the view, with a prompt before the
 * member has typed anything and an honest empty state after.
 */
function WorkspaceSearchResults({
  tone,
  query,
  results,
  onResult,
}: {
  tone: 'admin' | 'staff';
  query: string;
  results: readonly AdminSearchResult[];
  onResult: (result: AdminSearchResult) => void;
}) {
  return (
    <Screen tone={tone} keyboardShouldPersistTaps="handled">
      {!query.trim() ? (
        <Body muted>Search clients, schedule, reports and settings.</Body>
      ) : null}
      {query.trim() && !results.length ? (
        <Body muted>Nothing matches “{query.trim()}”.</Body>
      ) : null}
      {results.map((result) => (
        <PillRow
          key={result.id}
          title={result.title}
          subtitle={result.subtitle}
          symbol={result.kind === 'client' ? 'person.crop.circle' : 'doc.text'}
          onPress={() => onResult(result)}
        />
      ))}
    </Screen>
  );
}

function destinationDescription(path: string): string {
  const descriptions: Readonly<Record<string, string>> = {
    '/admin/dashboard': 'Today, revenue, schedule, and care actions',
    '/admin/calendar': 'Schedule, availability, and order status',
    '/admin/clients': 'Profiles, care records, and communication',
    '/admin/pos': 'Checkout, tips, and payment collection',
    '/admin/items': 'Menu items, sizes, pricing, and add-ons',
    '/admin/talent-acquisition': 'Applicants, interviews, and hiring',
    '/admin/staff': 'Team access, permissions, and availability',
    '/admin/rewards': 'Tiers, earning rules, points, and expiry',
    '/admin/reviews': 'Feedback, replies, and reputation',
    '/admin/marketing': 'Campaigns, promotions, gifts, and automations',
    '/admin/analytics': 'Traffic, conversions, and content',
    '/admin/ads': 'Campaigns, keywords, spend, and bookings',
    '/admin/settings': 'Availability, booking rules, payments, and forms',
    '/admin/reports': 'Sales, income, payouts, and service mix',
  };
  return descriptions[path] ?? 'Administration';
}

function destinationSymbol(path: string): 'person.crop.circle' | 'calendar' | 'creditcard' | 'star' | 'message' | 'doc.text' | 'heart' | 'gearshape' | 'square.grid.2x2' {
  if (path.includes('calendar')) return 'calendar';
  if (path.includes('client') || path.includes('staff') || path.includes('talent')) return 'person.crop.circle';
  if (path.includes('pos')) return 'creditcard';
  if (path.includes('review')) return 'star';
  if (path.includes('marketing') || path.includes('analytics') || path.includes('ads') || path.includes('reports')) return 'message';
  if (path.includes('settings')) return 'gearshape';
  if (path.includes('dashboard')) return 'square.grid.2x2';
  if (path.includes('service')) return 'heart';
  return 'doc.text';
}

const createStyles = (tokens: BrandTokens) => StyleSheet.create({
  header: { gap: tokens.spacing.lg, padding: tokens.spacing.lg },
  headerTop: { flexDirection: 'row', alignItems: 'center', gap: tokens.spacing.md, minHeight: 54 },
  identity: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: tokens.spacing.md, minHeight: 54 },
  // Gold monogram on plum, exactly as the web ProfileCard renders it.
  avatar: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: tokens.accent },
  avatarText: { color: tokens.textPrimary, fontFamily: tokens.fontDisplay, fontSize: 17 },
  identityCopy: { flex: 1, minWidth: 0 },
  identityName: { color: tokens.textPrimary, fontFamily: tokens.fontDisplay, fontSize: 17 },
  identityMeta: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 3 },
  statusDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: tokens.success },
  identityRole: { color: tokens.textPrimary, fontFamily: tokens.fontBody, fontSize: 10 },
  identityPreview: { color: tokens.textMuted, fontFamily: tokens.fontBody, fontSize: 11, textTransform: 'capitalize' },
  metrics: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: 'rgba(70,48,78,0.14)', paddingTop: tokens.spacing.md },
  metric: { flex: 1, alignItems: 'center' },
  metricValue: { color: tokens.textPrimary, fontFamily: tokens.fontDisplay, fontSize: 15 },
  metricLabel: { color: tokens.textMuted, fontFamily: tokens.fontBody, fontSize: 9, letterSpacing: 0.6, textTransform: 'uppercase', marginTop: 3 },
  headerButton: { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.28)' },
  headerButtonActive: { backgroundColor: tokens.primary },
  badge: { position: 'absolute', top: -3, right: -2, minWidth: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: tokens.danger, borderWidth: 2, borderColor: tokens.surface },
  badgeText: { color: tokens.surfaceElevated, fontFamily: tokens.fontBody, fontSize: 10 },
  group: { gap: tokens.spacing.md },
  surface: { gap: tokens.spacing.lg },
  surfaceTitle: { color: tokens.textPrimary, fontFamily: tokens.fontBody, fontSize: 20 },
  profileName: { color: tokens.textPrimary, fontFamily: tokens.fontDisplay, fontSize: 25 },
  permission: { flexDirection: 'row', alignItems: 'center', gap: tokens.spacing.md },
  permissionText: { flex: 1, color: tokens.textPrimary, fontFamily: tokens.fontBody, fontSize: 13 },
  search: { minHeight: 52, borderRadius: tokens.radius.pill, borderWidth: 1, borderColor: 'rgba(255,255,255,0.24)', paddingHorizontal: tokens.spacing.lg, backgroundColor: 'rgba(0,0,0,0.22)', color: tokens.surfaceElevated, fontFamily: tokens.fontBody, fontSize: 16 },
  result: { minHeight: 62, flexDirection: 'row', alignItems: 'center', gap: tokens.spacing.md, borderBottomWidth: 1, borderBottomColor: 'rgba(70,48,78,0.12)' },
  resultCopy: { flex: 1 },
  resultTitle: { color: tokens.textPrimary, fontFamily: tokens.fontBody, fontSize: 14 },
  resultDetail: { color: tokens.textMuted, fontFamily: tokens.fontBody, fontSize: 11, lineHeight: 16, marginTop: 2 },
  notification: { minHeight: 60, flexDirection: 'row', alignItems: 'center', gap: tokens.spacing.md },
  notificationDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: tokens.danger },
  // The single gold surface in a plum workspace -- the web comment calls this
  // out deliberately: it is a document to show a client, not another nav row.
  proposalCard: { flexDirection: 'row', alignItems: 'center', gap: tokens.spacing.md, padding: tokens.spacing.md, backgroundColor: tokens.accent, borderColor: tokens.accent },
  proposalIcon: { width: 38, height: 38, borderRadius: tokens.radius.lg, alignItems: 'center', justifyContent: 'center', backgroundColor: tokens.surface },
  proposalCopy: { flex: 1 },
  proposalTitle: { color: tokens.textPrimary, fontFamily: tokens.fontDisplay, fontSize: 17 },
  proposalDetail: { color: tokens.textPrimary, fontFamily: tokens.fontBody, fontSize: 12, lineHeight: 16, marginTop: 1 },
  roundButton: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: tokens.surface },
  pressed: { opacity: 0.72, transform: [{ scale: 0.98 }] },
});
