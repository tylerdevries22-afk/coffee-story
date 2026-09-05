import { router } from 'expo-router';
import { Alert } from 'react-native';

import { PortalProfileCard } from '@/components/portal-profile-card';
import { Body, Button, Card, MoreFooter, PillRow, Screen, SectionTitle } from '@/components/ui';
import { CONSTRUCTION_CHANGE_REQUESTS } from '@/data/construction-demo';
import { useAppState } from '@/state/app-context';
import { useAuth } from '@/state/auth-context';
import { useDemo } from '@/state/demo-context';
import { TENANT } from '@/tenant';
import { TENANT_MEDIA } from '@/tenants/media';

const ACTIVE_STATUSES = new Set(['created', 'paid', 'in_progress', 'ready']);

export function ConstructionMoreScreen() {
  const { openMore, setClientTab } = useAppState();
  const { portal, isDemo, signOut } = useAuth();
  const demo = useDemo();
  const activeProjects = isDemo
    ? portal.orders.filter((entry) => ACTIVE_STATUSES.has(entry.status)).length
    : 0;
  const metrics = [
    { label: 'Active projects', value: String(activeProjects) },
    { label: 'Change requests', value: isDemo ? String(CONSTRUCTION_CHANGE_REQUESTS.length) : '—' },
    { label: 'Payment status', value: isDemo ? 'Current' : '—' },
  ] as const;

  return (
    <Screen>
      <PortalProfileCard
        name={portal.profile.fullName || 'Client'}
        avatarUrl={portal.profile.avatarUrl}
        roleLabel="Project client"
        previewLabel={isDemo ? 'Prototype data' : 'Live account'}
        metrics={metrics}
        profileLabel="Open account details"
        onProfile={() => openMore('profile')}
      />

      <Card><Body muted>{isDemo
        ? 'This is a read-only construction portal prototype. Approvals, payments, and downloads are not connected.'
        : 'Project, payment, and document records are not connected to this live account yet.'}</Body></Card>

      <SectionTitle>My project</SectionTitle>
      <PillRow title="Project overview" subtitle="Current milestone and project team"
        symbol="briefcase" onPress={() => setClientTab('book')} />
      <PillRow title="Milestones" subtitle="Planning through final handoff"
        symbol="clock.arrow.circlepath" onPress={() => setClientTab('book')} />
      <PillRow title="Change requests" subtitle="Read-only scope, schedule, and price impact"
        symbol="doc.text" onPress={() => setClientTab('book')} />
      <PillRow title="Payment schedule" subtitle="Deposit and progress draw status"
        symbol="creditcard" onPress={() => setClientTab('rewards')} />
      <PillRow title="Project documents" subtitle="Scope, selections, and payment schedule"
        symbol="doc.text" onPress={() => setClientTab('gift')} />
      {portal.messages !== undefined ? (
        <PillRow title="Messages" subtitle={`${portal.messages.filter((message) => !message.read).length} unread`}
          symbol="message" onPress={() => openMore('messages')} />
      ) : null}

      <SectionTitle>Planning and support</SectionTitle>
      <PillRow title="Regional offices" subtitle="Denver and Colorado Springs support preview"
        symbol="calendar" />
      <PillRow title="Project standards and resources"
        subtitle="Planning, safety, quality, and handoff references" symbol="doc.text" />
      <PillRow title="Frequently asked questions"
        subtitle="Project planning and change-request guidance" />
      <PillRow title="Project commitments and warranty"
        subtitle="Estimates, deposits, handoff, and warranty preview" />

      <SectionTitle>Account</SectionTitle>
      <PillRow title="Account details" subtitle={portal.profile.fullName}
        symbol="person.crop.circle" onPress={() => openMore('profile')} />

      {isDemo ? (
        <>
          <Button label="Reset prototype data" variant="secondary" onPress={() => {
            Alert.alert('Reset prototype?', 'Project preview data and messages will return to their starting state.', [
              { text: 'Keep changes', style: 'cancel' },
              { text: 'Reset', style: 'destructive', onPress: () => void demo.resetDemo() },
            ]);
          }} />
          {demo.canGoLive ? (
            <Button label="Sign in to your account" variant="secondary"
              onPress={() => void demo.chooseLive().then(() => router.replace('/'))} />
          ) : null}
        </>
      ) : (
        <Button label="Sign out" variant="secondary" onPress={() => void signOut()} />
      )}

      <MoreFooter
        onPrivacy={() => openMore('privacy')}
        onTerms={() => openMore('privacy')}
        version={`${TENANT.identity.name} 1.0`}
        caption={isDemo ? 'Prototype data · changes stay on this device' : 'Live project data is not connected'}
        iconSrc={TENANT_MEDIA.brandLogo}
      />
    </Screen>
  );
}
