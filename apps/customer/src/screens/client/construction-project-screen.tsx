import { Text } from 'react-native';

import { CollapsingScreen } from '@/components/collapsing-screen';
import { Body, Button, Card, PillRow, SectionTitle } from '@/components/ui';
import {
  CONSTRUCTION_CHANGE_REQUESTS,
  CONSTRUCTION_DOCUMENTS,
  CONSTRUCTION_PROGRESS_DRAWS,
} from '@/data/construction-demo';
import { trackingView } from '@/features/tracking';
import { useAppState } from '@/state/app-context';
import { useAuth } from '@/state/auth-context';
import { useTokens as useBrandTokens } from '@platform/ui';

const ACTIVE_STATUSES = new Set(['created', 'paid', 'in_progress', 'ready']);

export function ConstructionProjectScreen({ onBack }: { onBack?: () => void }) {
  const tokens = useBrandTokens();
  const { portal, isDemo } = useAuth();
  const { openMore, setClientTab } = useAppState();
  const project = portal.orders.find((entry) => ACTIVE_STATUSES.has(entry.status));
  const projectTracking = project ? trackingView(project.status, 'construction') : null;

  return (
    <CollapsingScreen title="Project" eyebrow="Client portal prototype" onBack={onBack}>
      <Card>
        <Body muted>{isDemo
          ? 'Preview data only. Project actions are not connected to a live construction system.'
          : 'Live project records are not connected in this build.'}</Body>
      </Card>

      {isDemo && project && projectTracking ? (
        <>
          <Card>
            <Text style={{ color: tokens.textPrimary, fontFamily: tokens.fontDisplay, fontSize: 24 }}>
              {project.summary}
            </Text>
            <Body muted>Kitchen renovation · Denver project team</Body>
          </Card>

          <SectionTitle>Milestones</SectionTitle>
          {projectTracking.steps.map((step, index) => {
            const { activeIndex } = projectTracking;
            const state = index < activeIndex ? 'Complete' : index === activeIndex ? 'Current' : 'Upcoming';
            return (
              <PillRow
                key={step.status}
                title={step.title}
                subtitle={step.detail}
                symbol={index <= activeIndex ? 'checkmark.circle.fill' : 'clock'}
                value={<Body muted>{state}</Body>}
              />
            );
          })}

          <SectionTitle>Change requests</SectionTitle>
          {CONSTRUCTION_CHANGE_REQUESTS.map((request) => (
            <PillRow key={request.id} title={`${request.id} · ${request.title}`}
              subtitle={request.detail} value={<Body muted>{request.status}</Body>} />
          ))}

          <SectionTitle>Payment status</SectionTitle>
          <PillRow title="Deposit and progress draws" subtitle="View the read-only payment schedule"
            symbol="creditcard" onPress={() => setClientTab('rewards')} />

          <SectionTitle>Documents</SectionTitle>
          <PillRow title={`${CONSTRUCTION_DOCUMENTS.length} project documents`}
            subtitle="Scope, selections, and payment schedule" symbol="doc.text"
            onPress={() => setClientTab('gift')} />
        </>
      ) : null}

      {!isDemo || !project ? (
        <Card><Body muted>No project milestone data is available from a live source.</Body></Card>
      ) : null}
      {portal.messages !== undefined ? (
        <Button label="Message project team" onPress={() => openMore('messages')} />
      ) : null}
    </CollapsingScreen>
  );
}

export function ConstructionDocumentsScreen() {
  const { isDemo } = useAuth();
  return (
    <CollapsingScreen title="Documents" eyebrow="Project records">
      <Card><Body muted>{isDemo
        ? 'Preview document statuses only. File download is not connected.'
        : 'Live project documents are not connected in this build.'}</Body></Card>
      {isDemo ? CONSTRUCTION_DOCUMENTS.map((document) => (
        <PillRow key={document.id} title={document.title} symbol="doc.text"
          value={<Body muted>{document.status}</Body>} />
      )) : null}
    </CollapsingScreen>
  );
}

export function ConstructionPaymentsScreen() {
  const { isDemo } = useAuth();
  return (
    <CollapsingScreen title="Payments" eyebrow="Project schedule">
      <Card><Body muted>{isDemo
        ? 'Preview statuses only. Payment and invoice actions are not connected.'
        : 'Live payment records are not connected in this build.'}</Body></Card>
      {isDemo ? CONSTRUCTION_PROGRESS_DRAWS.map((draw) => (
        <PillRow key={draw.id} title={draw.title} subtitle={draw.detail}
          symbol="creditcard" value={<Body muted>{draw.status}</Body>} />
      )) : null}
    </CollapsingScreen>
  );
}
