import { Redirect } from 'expo-router';
import { View, StyleSheet } from 'react-native';

import { StaffTabs } from '@/components/navigation/staff-tabs';
import { ErrorState, LoadingState } from '@/components/ui';
import { useAppState } from '@/state/app-context';
import { useAuth } from '@/state/auth-context';
import { OperatorProvider } from '@/state/operator-store';
import { StaffWorkspaceProvider, useStaffWorkspace } from '@/state/staff-workspace';

/** See `client/_layout.tsx`'s equivalent guard for why this redirect exists. */
export default function StaffLayout() {
  const { isStaffMode } = useAppState();
  const { isAuthenticated, isLoading } = useAuth();
  // Both answers below are still loading on a cold open: the session restores
  // asynchronously, and isStaffMode derives from the role the tenant claims
  // carry, which arrives with the portal. Redirecting before either resolves
  // threw a barista opening a board link straight back to sign-in.
  if (isLoading) return <View style={styles.shell}><LoadingState label="Loading the staff workspace…" /></View>;
  if (!isAuthenticated) return <Redirect href="/" />;
  if (!isStaffMode) return <Redirect href="/" />;
  return (
    <StaffWorkspaceProvider>
      <OperatorProvider>
        <StaffLayoutBody />
      </OperatorProvider>
    </StaffWorkspaceProvider>
  );
}

function StaffLayoutBody() {
  const { error, loading, reload } = useStaffWorkspace();
  if (loading) return <View style={styles.shell}><LoadingState label="Loading the staff workspace…" /></View>;
  if (error) return <View style={styles.shell}><ErrorState message={error} onRetry={() => void reload()} /></View>;
  return (
    <View style={styles.shell}>
      <StaffTabs />
    </View>
  );
}

const styles = StyleSheet.create({ shell: { flex: 1 } });
