import { CollapsingScreen } from '@/components/collapsing-screen';
import { Body, Card, PillRow, SectionTitle } from '@/components/ui';
import { useAuth } from '@/state/auth-context';

export function ConstructionAccountScreen({ onBack }: { onBack: () => void }) {
  const { portal, isDemo } = useAuth();
  const { profile } = portal;
  return (
    <CollapsingScreen title="Account details" eyebrow="Project client" onBack={onBack}>
      <Card>
        <Body muted>
          {isDemo
            ? 'These are prototype profile details. Account editing is not connected.'
            : 'Account editing is not connected in this build.'}
        </Body>
      </Card>
      <PillRow title="Name" value={<Body muted>{profile.fullName || 'Not provided'}</Body>} />
      <PillRow title="Email" value={<Body muted>{profile.email}</Body>} />
      <PillRow title="Phone" value={<Body muted>{profile.phone || 'Not provided'}</Body>} />
    </CollapsingScreen>
  );
}

export function ConstructionPrivacyScreen({ onBack }: { onBack: () => void }) {
  return (
    <CollapsingScreen title="Privacy & terms" eyebrow="Prototype notice" onBack={onBack}>
      <Card>
        <Body muted>
          The production privacy notice and terms are not connected in this prototype. Publish
          counsel-reviewed documents before release.
        </Body>
      </Card>
      <SectionTitle>Prototype data handling</SectionTitle>
      <PillRow title="Account details" subtitle="Used to label the client portal preview" />
      <PillRow title="Project communication" subtitle="Shown only within the signed-in experience" />
      <PillRow
        title="Construction payments"
        subtitle="No payment or card action is connected in this prototype"
      />
    </CollapsingScreen>
  );
}
