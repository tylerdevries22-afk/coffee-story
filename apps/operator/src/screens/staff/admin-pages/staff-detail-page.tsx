import { ErrorState, LoadingState } from '@/components/ui';
import { AdminSettingsScreen } from '@/screens/staff/admin-settings-screen';
import { AdminProposalScreen } from '@/screens/staff/admin-proposal-screen';
import { AdminRewardsScreen } from '@/screens/staff/admin-rewards-screen';
import type { AdminSettingsState } from '@/features/admin/admin-settings';

import { AdminServicesScreen } from '@/screens/staff/admin-services-screen';
import { NativeAdminPage } from './native-admin-page';

export function StaffDetailPage({
  path,
  settings,
  settingsLoading,
  settingsReady,
  settingsError,
  isDemo,
  onBack,
  onRetrySettings,
  onSaveSettings,
}: {
  path: string;
  settings: AdminSettingsState;
  settingsLoading: boolean;
  settingsReady: boolean;
  settingsError: string | null;
  isDemo: boolean;
  onBack: () => void;
  onRetrySettings: () => void;
  onSaveSettings: (settings: AdminSettingsState) => Promise<void>;
}) {
  if (path === '/proposal') return <AdminProposalScreen onBack={onBack} />;
  // Ahead of the demo-mode gate below: the rules it shows come from the bundled
  // rewards module, so they are accurate with or without a backend.
  if (path === '/admin/rewards') return <AdminRewardsScreen onBack={onBack} />;
  if (path === '/admin/settings') {
    if (settingsError) {
      return <ErrorState title="Settings did not load." message={settingsError} onRetry={onRetrySettings} />;
    }
    if (!settingsReady) return <LoadingState label="Loading business settings…" />;
    return (
      <AdminSettingsScreen
        settings={settings}
        isDemo={isDemo}
        loading={settingsLoading}
        onBack={onBack}
        onSave={onSaveSettings}
      />
    );
  }
  if (path === '/admin/services') {
    return <AdminServicesScreen onBack={onBack} />;
  }
  return <NativeAdminPage path={path} isDemo={isDemo} onBack={onBack} />;
}
