import { Alert } from 'react-native';

import { CollapsingScreen } from '@/components/collapsing-screen';
import { Body, Button, Card, PillRow, Screen, SectionTitle, Title } from '@/components/ui';
import { useAppState } from '@/state/app-context';
import { useAuth } from '@/state/auth-context';
import { useBusiness } from '@/state/business';
import { useDemo } from '@/state/demo-context';

export function BaseMoreScreen() {
  const business = useBusiness();
  const { openMore } = useAppState();
  const { isDemo, portal, signOut } = useAuth();
  const demo = useDemo();
  return (
    <Screen>
      <Title>Profile</Title>
      <Card>
        <SectionTitle>{portal.profile.fullName || 'Member'}</SectionTitle>
        <Body muted>{portal.profile.email}</Body>
      </Card>
      <SectionTitle>Account</SectionTitle>
      <PillRow title="Account details" symbol="person.crop.circle"
        onPress={() => openMore('profile')} />
      <PillRow title="Location and hours" subtitle={`${business.street}, ${business.cityLine}`}
        symbol="calendar" onPress={() => openMore('location')} />
      <PillRow title="Guides and resources" symbol="doc.text"
        onPress={() => openMore('resources')} />
      <PillRow title="Frequently asked questions" onPress={() => openMore('faq')} />
      <PillRow title="Privacy and terms" onPress={() => openMore('privacy')} />
      {isDemo ? (
        <Button label="Reset preview data" variant="secondary" onPress={() => {
          Alert.alert('Reset preview?', 'Account details will return to their starting state.', [
            { text: 'Keep changes', style: 'cancel' },
            { text: 'Reset', style: 'destructive', onPress: () => void demo.resetDemo() },
          ]);
        }} />
      ) : <Button label="Sign out" variant="secondary" onPress={() => void signOut()} />}
    </Screen>
  );
}

export function BaseAccountScreen({ onBack }: { onBack: () => void }) {
  const { portal, isDemo } = useAuth();
  const { profile } = portal;
  return (
    <CollapsingScreen title="Account details" eyebrow="My account" onBack={onBack}>
      <Card><Body muted>{isDemo
        ? 'These are preview profile details. Account editing is not connected.'
        : 'Account editing is not connected in this build.'}</Body></Card>
      <PillRow title="Name" value={<Body muted>{profile.fullName || 'Not provided'}</Body>} />
      <PillRow title="Email" value={<Body muted>{profile.email}</Body>} />
      <PillRow title="Phone" value={<Body muted>{profile.phone || 'Not provided'}</Body>} />
    </CollapsingScreen>
  );
}
