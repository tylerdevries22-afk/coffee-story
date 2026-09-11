import type { AppRole } from '@platform/domain';

import { Body, Button, Card, SectionTitle } from '@/components/ui';

type ClientDataCardProps = {
  accessCardStyle: object;
  exporting: boolean;
  deleting: boolean;
  onDownload: () => void;
  onDelete: () => void;
};

export function ClientDataCard({
  accessCardStyle, exporting, deleting, onDownload, onDelete,
}: ClientDataCardProps) {
  return (
    <Card style={accessCardStyle}>
      <SectionTitle>Your data</SectionTitle>
      <Body muted>Download a copy of your profile, orders, loyalty, and notification settings before you leave.</Body>
      <Button
        label="Download my data"
        variant="soft"
        loading={exporting}
        disabled={exporting || deleting}
        onPress={onDownload}
      />
      <SectionTitle>Delete account</SectionTitle>
      <Body muted>Your personal details and sign-in will be removed. An anonymized order record remains with the shop.</Body>
      <Button
        label="Delete my account"
        variant="secondary"
        loading={deleting}
        disabled={deleting || exporting}
        onPress={onDelete}
      />
    </Card>
  );
}

type WorkspaceAccessCardProps = {
  accessCardStyle: object;
  role: AppRole;
  onExit?: () => void;
  onSignOut?: () => void;
};

export function WorkspaceAccessCard({
  accessCardStyle, role, onExit, onSignOut,
}: WorkspaceAccessCardProps) {
  return (
    <Card style={accessCardStyle}>
      <SectionTitle>Workspace access</SectionTitle>
      <Body muted>{role === 'admin'
        ? 'Owner permissions include business settings, reports, staff, and all operations.'
        : 'Team member permissions include schedule, clients, checkout, and reviews.'}</Body>
      {onExit ? <Button label="Return to client app" variant="secondary" onPress={onExit} /> : null}
      {onSignOut ? <Button label="Sign out" variant="soft" onPress={onSignOut} /> : null}
    </Card>
  );
}
