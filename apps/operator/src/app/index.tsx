import { Redirect } from 'expo-router';

import { AuthScreen, PasswordRecoveryScreen } from '@/screens/auth/auth-screen';
import { useAppState } from '@/state/app-context';
import { useAuth } from '@/state/auth-context';
import { ErrorState, LoadingState } from '@/components/ui';

/**
 * The auth gate. `InstallPrompt` and `SetupFlowHost` used to mount here too,
 * back when this screen WAS the entire app; they moved to the root layout
 * (see `_layout.tsx`) so they stay mounted once this redirects into a shell.
 */
export default function AppIndex() {
  const { isStaffMode } = useAppState();
  const { error, isAuthenticated, isDemo, isLoading, isPasswordRecovery, refresh, session } = useAuth();
  if (isLoading) return <LoadingState label="Preparing your private portal" />;
  if (isPasswordRecovery) return <PasswordRecoveryScreen />;
  if (!isAuthenticated) return <AuthScreen />;
  if (!isDemo && session && error) return <ErrorState title="Your live account did not load." message={error} onRetry={() => void refresh()} />;
  // Rule 7 in reverse: this is the operator binary. A guest account has no
  // shell here and gets pointed at the brand's own app instead.
  if (!isStaffMode) {
    return (
      <ErrorState
        title="This is the operator app."
        message="Your account is a guest account. Order from the brand's own app; staff and manager logins work here."
      />
    );
  }
  return <Redirect href="/staff" />;
}
