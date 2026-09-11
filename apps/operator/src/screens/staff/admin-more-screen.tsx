import * as Haptics from 'expo-haptics';
import { router, type Href } from 'expo-router';
import { useMemo, useState } from 'react';
import { Alert, Text, View, useWindowDimensions } from 'react-native';

import { MoreSearchTakeover } from '@/components/more-search-takeover';
import { PreviewRolePicker } from '@/components/preview-role-picker';
import { ProfileAvatar } from '@/components/profile-avatar';
import { Screen } from '@/components/ui';
import {
  adminNavigationGroupsForRole,
  searchAdminWorkspace,
} from '@/features/admin/admin-navigation';
import { portalSetup, setupProgressPercent } from '@/features/setup/setup';
import { openWebPath } from '@/lib/web-navigation';
import { operatorLayout } from '@/lib/responsive-layout';
import { Profile } from '@/screens/staff/profile';
import { useAppState } from '@/state/app-context';
import { useAuth } from '@/state/auth-context';
import { useOperations } from '@/state/operations-store';
import { buildStaffNotifications, type StaffDashboard } from '@platform/domain';
import { useAppTokens } from '@platform/ui';

import {
  destinationSymbol,
  MoreGroup,
  MoreRow,
  WorkspaceSearchResults,
} from './admin-more-components';
import { createAdminMoreStyles } from './admin-more-styles';

type HeaderSurface = 'profile' | null;

/** Compact role-aware directory, matching the reference More hierarchy. */
export function AdminMoreScreen({ dashboard }: { dashboard: StaffDashboard }) {
  const appTokens = useAppTokens();
  const styles = createAdminMoreStyles(appTokens);
  const { width, height } = useWindowDimensions();
  const layout = operatorLayout(width, height);
  const {
    exitStaff, openNotifications, openStaffDestination, queueSetupPrompt,
    readNotificationIds, selectRole,
  } = useAppState();
  const { isDemo, portal, role, signOut } = useAuth();
  const operations = useOperations();
  const [surface, setSurface] = useState<HeaderSurface>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const groups = adminNavigationGroupsForRole(role);
  const notifications = useMemo(() => buildStaffNotifications(dashboard, new Date()), [dashboard]);
  const unreadCount = notifications.filter((item) => !readNotificationIds.has(item.id)).length
    + operations.unreadCount;
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
          {operations.enabled ? <MoreRow title="Shift Tasks"
            subtitle={operations.pendingCount > 0
              ? `${operations.pendingCount} syncing`
              : `${operations.occurrences.filter((item) => !['completed', 'missed', 'cancelled'].includes(item.status)).length} active`}
            symbol="person.2" onPress={() => openRoute('/staff/crew')} first /> : null}
          <MoreRow title="Calendar" symbol="calendar" onPress={() => openRoute('/staff/calendar')} />
          <MoreRow title="Training" symbol="doc.text" onPress={() => openRoute('/staff/training')} />
          <MoreRow title="Notifications" subtitle={unreadCount > 0 ? `${unreadCount} unread` : undefined}
            symbol="bell" onPress={() => openNotifications([
              ...notifications.map((item) => item.id),
              ...operations.notifications.map((item) => `operation-notification-${item.id}`),
            ])} />
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
