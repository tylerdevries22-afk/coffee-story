import { Redirect } from 'expo-router';
import { View, StyleSheet } from 'react-native';

import { StaffTabs } from '@/components/navigation/staff-tabs';
import { ErrorState, LoadingState } from '@/components/ui';
import { useAppState } from '@/state/app-context';
import { useAuth } from '@/state/auth-context';
import { StaffWorkspaceProvider, useStaffWorkspace } from '@/state/staff-workspace';

/** See `client/_layout.tsx`'s equivalent guard for why this redirect exists. */
export default function StaffLayout() {
  const { isStaffMode } = useAppState();
  const { isAuthenticated } = useAuth();
  if (!isAuthenticated) return <Redirect href="/" />;
  if (!isStaffMode) return <Redirect href="/client" />;
  return (
    <StaffWorkspaceProvider>
      <StaffLayoutBody />
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
