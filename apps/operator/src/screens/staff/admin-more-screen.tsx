import * as Haptics from 'expo-haptics';
import { router, type Href } from 'expo-router';
import { useMemo, useState, type ReactNode } from 'react';
import { Alert, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import { AppIcon, type AppIconName } from '@/components/icon';
import { MoreSearchTakeover } from '@/components/more-search-takeover';
import { PreviewRolePicker } from '@/components/preview-role-picker';
import { ProfileAvatar } from '@/components/profile-avatar';
import { Body, PillRow, Screen } from '@/components/ui';
import {
  adminNavigationGroupsForRole,
  searchAdminWorkspace,
  type AdminSearchResult,
} from '@/features/admin/admin-navigation';
import { portalSetup, setupProgressPercent } from '@/features/setup/setup';
import { openWebPath } from '@/lib/web-navigation';
import { operatorLayout } from '@/lib/responsive-layout';
import { Profile } from '@/screens/staff/profile';
import { useAppState } from '@/state/app-context';
import { useAuth } from '@/state/auth-context';
import { buildStaffNotifications, type StaffDashboard } from '@platform/domain';
import { useAppTokens, type AppTokens } from '@platform/ui';

type HeaderSurface = 'profile' | null;

/** Compact role-aware directory, matching the reference More hierarchy. */
export function AdminMoreScreen({ dashboard }: { dashboard: StaffDashboard }) {
  const appTokens = useAppTokens();
  const styles = createStyles(appTokens);
  const { width, height } = useWindowDimensions();
  const layout = operatorLayout(width, height);
  const {
    exitStaff, openNotifications, openStaffDestination, queueSetupPrompt,
    readNotificationIds, selectRole,
  } = useAppState();
  const { isDemo, portal, role, signOut } = useAuth();
  const [surface, setSurface] = useState<HeaderSurface>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const groups = adminNavigationGroupsForRole(role);
  const notifications = useMemo(() => buildStaffNotifications(dashboard, new Date()), [dashboard]);
  const unreadCount = notifications.filter((item) => !readNotificationIds.has(item.id)).length;
  const setup = portalSetup(portal)[role];
  const searchResults = useMemo(
    () => searchAdminWorkspace(query, role, dashboard.clients),
    [dashboard.clients, query, role],
  );
  const profileName = portal.profile.fullName || 'Team member';

  function openRoute(href: string) {
    void Haptics.selectionAsync();
    router.push(href as Href);
  }

  function openDestination(path: string) {
    setSurface(null);
    setQuery('');
    openStaffDestination(path);
  }

  function handleSignOut() {
    if (isDemo) {
      exitStaff();
      return;
    }
    void signOut().catch((error: unknown) => {
      Alert.alert('Sign out failed', error instanceof Error ? error.message : 'Try again.');
    });
  }

  if (surface === 'profile') {
    return <Profile onBack={() => setSurface(null)} onExit={exitStaff} onSignOut={!isDemo ? handleSignOut : undefined} />;
  }

  return (
    <MoreSearchTakeover
      searching={searchOpen}
      onClose={() => { setSearchOpen(false); setQuery(''); }}
      query={query}
      onQueryChange={setQuery}
      placeholder="Guests, schedule, reports…"
      accessibilityLabel="Search operator tools"
      surfaceColor={appTokens.colors.warm}
      results={<WorkspaceSearchResults query={query} results={searchResults} onResult={(result) => {
        setSearchOpen(false);
        openDestination(result.path);
      }} />}
    >
      <Screen
        contentContainerStyle={[
          styles.content,
          layout.isTablet && {
            width: '100%',
            maxWidth: layout.contentMaxWidth,
            alignSelf: 'center',
          },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        <Text accessibilityRole="header" style={styles.pageTitle}>More</Text>
        <MoreGroup>
          <MoreRow
            title={profileName}
            subtitle={role === 'admin' ? 'Owner' : 'Team member'}
            leading={<ProfileAvatar name={profileName} avatarUrl={portal.profile.avatarUrl} size={48} />}
            onPress={() => setSurface('profile')}
            first
          />
        </MoreGroup>
        <MoreGroup label="Daily Work">
          <MoreRow title="Crew" symbol="person.2" onPress={() => openRoute('/staff/crew')} first />
          <MoreRow title="Calendar" symbol="calendar" onPress={() => openRoute('/staff/calendar')} />
          <MoreRow title="Training" symbol="doc.text" onPress={() => openRoute('/staff/training')} />
          <MoreRow title="Notifications" subtitle={unreadCount > 0 ? `${unreadCount} unread` : undefined} symbol="bell" onPress={() => openNotifications(notifications.map((item) => item.id))} />
        </MoreGroup>
        <MoreGroup label="My Account">
          <MoreRow title="My Rewards" symbol="cup.and.saucer" onPress={() => openDestination('/admin/rewards')} first />
          <MoreRow title="Account settings" symbol="person.crop.circle" onPress={() => setSurface('profile')} />
          <MoreRow title="Messages" symbol="message" onPress={() => openDestination('/admin/clients')} />
          <MoreRow title="Search tools" symbol="magnifyingglass" onPress={() => setSearchOpen(true)} />
        </MoreGroup>
        {groups.map((group) => {
          const destinations = group.destinations.filter((destination) => destination.path !== '/admin/calendar' && destination.path !== '/admin/rewards');
          if (destinations.length === 0) return null;
          return (
            <MoreGroup key={group.title} label={group.title}>
              {destinations.map((destination, index) => (
                <MoreRow key={destination.path} title={destination.title} symbol={destinationSymbol(destination.path)} onPress={() => openDestination(destination.path)} first={index === 0} />
              ))}
            </MoreGroup>
          );
        })}
        <MoreGroup>
          <MoreRow title="Website Proposal" symbol="doc.text" onPress={() => openDestination('/proposal')} first />
        </MoreGroup>
        {isDemo ? (
          <MoreGroup label="Demo">
            <MoreRow title="Continue setup" subtitle={`${setupProgressPercent(setup)}% complete`} symbol="gearshape" onPress={() => queueSetupPrompt(role)} first />
            <View style={styles.previewPicker}><PreviewRolePicker role={role} onChange={selectRole} /></View>
          </MoreGroup>
        ) : null}
        <MoreGroup label="Support">
          <MoreRow title="Privacy" symbol="lock" onPress={() => void openWebPath('/privacy')} first />
          <MoreRow title="Terms" symbol="doc.plaintext" onPress={() => void openWebPath('/privacy')} />
          <MoreRow title={isDemo ? 'Exit operator mode' : 'Sign out'} symbol="arrow.up.right" onPress={handleSignOut} />
        </MoreGroup>
        <Text style={styles.version}>Operator 1.0</Text>
      </Screen>
    </MoreSearchTakeover>
  );
}

function MoreGroup({ label, children }: { label?: string; children: ReactNode }) {
  const styles = createStyles(useAppTokens());
  return <View style={styles.groupWrap}>{label ? <Text style={styles.groupLabel}>{label}</Text> : null}<View style={styles.group}>{children}</View></View>;
}

function MoreRow({ title, subtitle, symbol, leading, onPress, first = false }: {
  title: string;
  subtitle?: string;
  symbol?: AppIconName;
  leading?: ReactNode;
  onPress: () => void;
  first?: boolean;
}) {
  const appTokens = useAppTokens();
  const { colors } = appTokens;
  const styles = createStyles(appTokens);
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={subtitle ? `${title}, ${subtitle}` : title} onPress={onPress} style={({ pressed }) => [styles.row, !first && styles.rowDivider, pressed && styles.pressed]}>
      {leading ?? (symbol ? <View style={styles.rowIcon}><AppIcon name={symbol} size={19} tintColor={colors.ink700} /></View> : null)}
      <View style={styles.rowCopy}><Text numberOfLines={1} style={styles.rowTitle}>{title}</Text>{subtitle ? <Text numberOfLines={1} style={styles.rowSubtitle}>{subtitle}</Text> : null}</View>
      <AppIcon name="chevron.right" size={16} tintColor={colors.ink400} />
    </Pressable>
  );
}

function WorkspaceSearchResults({ query, results, onResult }: { query: string; results: readonly AdminSearchResult[]; onResult: (result: AdminSearchResult) => void }) {
  return (
    <Screen keyboardShouldPersistTaps="handled">
      {!query.trim() ? <Body muted>Search guests, schedule, reports and settings.</Body> : null}
      {query.trim() && !results.length ? <Body muted>Nothing matches “{query.trim()}”.</Body> : null}
      {results.map((result) => <PillRow key={result.id} title={result.title} subtitle={result.subtitle} symbol={result.kind === 'client' ? 'person.crop.circle' : 'doc.text'} onPress={() => onResult(result)} />)}
    </Screen>
  );
}

function destinationSymbol(path: string): AppIconName {
  if (path.includes('calendar')) return 'calendar';
  if (path.includes('client') || path.includes('staff') || path.includes('talent')) return 'person.crop.circle';
  if (path.includes('pos')) return 'creditcard';
  if (path.includes('review')) return 'star';
  if (path.includes('settings')) return 'gearshape';
  if (path.includes('dashboard')) return 'square.grid.2x2';
  if (path.includes('marketing') || path.includes('analytics') || path.includes('ads')) return 'message';
  return 'doc.text';
}

function createStyles({ colors, fonts, radius, spacing }: AppTokens) {
  return StyleSheet.create({
    content: { gap: spacing.md, paddingHorizontal: spacing.md, paddingBottom: spacing.xxl, backgroundColor: colors.warm },
    pageTitle: { color: colors.ink900, fontFamily: fonts.sansBold, fontSize: 24, marginBottom: spacing.xs },
    groupWrap: { gap: spacing.xs },
    groupLabel: { color: colors.ink700, fontFamily: fonts.sansBold, fontSize: 13, paddingHorizontal: spacing.xs },
    group: { overflow: 'hidden', borderWidth: 1, borderColor: colors.ink200, borderRadius: radius.sm, backgroundColor: colors.white },
    row: { minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, backgroundColor: colors.white },
    rowDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.ink200 },
    rowIcon: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
    rowCopy: { flex: 1, minWidth: 0 },
    rowTitle: { color: colors.ink900, fontFamily: fonts.sansBold, fontSize: 16 },
    rowSubtitle: { color: colors.ink600, fontFamily: fonts.sans, fontSize: 13, marginTop: 2 },
    pressed: { backgroundColor: colors.brand50 },
    previewPicker: { padding: spacing.sm },
    version: { color: colors.ink400, fontFamily: fonts.sans, fontSize: 12, paddingHorizontal: spacing.xs },
  });
}
