import { Redirect } from 'expo-router';
import { View, StyleSheet } from 'react-native';

import { StaffTabs } from '@/components/navigation/staff-tabs';
import { useAppState } from '@/state/app-context';
import { useAuth } from '@/state/auth-context';
import { OperatorProvider } from '@/state/operator-store';
import { StaffWorkspaceProvider } from '@/state/staff-workspace';

/** See the auth gate in `app/index.tsx` for why these redirects exist. */
export default function StaffLayout() {
  const { isStaffMode } = useAppState();
  const { isAuthenticated } = useAuth();
  if (!isAuthenticated) return <Redirect href="/" />;
  if (!isStaffMode) return <Redirect href="/" />;
  // OperatorProvider sits outside the workspace provider on purpose: the board
  // is this app's reason to exist and reads Supabase directly under staff RLS,
  // so it must not inherit the workspace's failure modes. The tab shell renders
  // unconditionally for the same reason -- screens that need the workspace wrap
  // themselves in `StaffWorkspaceGate` instead.
  return (
    <OperatorProvider>
      <StaffWorkspaceProvider>
        <View style={styles.shell}>
          <StaffTabs />
        </View>
      </StaffWorkspaceProvider>
    </OperatorProvider>
  );
}

const styles = StyleSheet.create({ shell: { flex: 1 } });
