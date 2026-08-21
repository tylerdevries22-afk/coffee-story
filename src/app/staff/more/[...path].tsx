import { usePathname } from 'expo-router';

import { StaffDetailPage } from '@/screens/staff/admin-pages/staff-detail-page';
import { useAppState } from '@/state/app-context';
import { useAuth } from '@/state/auth-context';
import { staffDetailPathFromPathname } from '@/state/navigation-state';
import { useStaffWorkspace } from '@/state/staff-workspace';

/**
 * Every admin destination that isn't the menu itself or Checkout, as one
 * catch-all route rather than one file per destination.
 *
 * `StaffDetailPage` already multiplexes an open-ended, config-driven set of
 * web-portal paths (`/admin/reviews`, `/admin/staff`, `/admin/talent-acquisition`,
 * ...) from `features/admin/admin-navigation.ts` -- that table is the
 * source of truth for what exists, not the router. Splitting it into a literal
 * route per path would duplicate that table with no navigational benefit: the
 * push animation, swipe-back and pop-to-root this migration is after come
 * from THIS route existing in the More stack at all, not from how many files
 * back it. `staffDetailPathFromPathname` reconstructs the original
 * `/admin/...` path from the matched segments.
 */
export default function StaffMoreDetailRoute() {
  const pathname = usePathname();
  const { closeStaffDestination } = useAppState();
  const { isDemo } = useAuth();
  const {
    adminSettings, loadSettings, saveAdminSettings, settingsError, settingsLoading, settingsReady,
  } = useStaffWorkspace();
  const path = staffDetailPathFromPathname(pathname) ?? '/admin/dashboard';
  return (
    <StaffDetailPage
      path={path}
      settings={adminSettings}
      settingsLoading={settingsLoading}
      settingsReady={settingsReady}
      settingsError={settingsError}
      isDemo={isDemo}
      onBack={closeStaffDestination}
      onRetrySettings={() => void loadSettings()}
      onSaveSettings={saveAdminSettings}
    />
  );
}
