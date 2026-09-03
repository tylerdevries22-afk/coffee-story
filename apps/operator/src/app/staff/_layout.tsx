import { Redirect } from 'expo-router';
import { View, StyleSheet } from 'react-native';

import { StaffTabs } from '@/components/navigation/staff-tabs';
import { LoadingState } from '@/components/ui';
import { useAppState } from '@/state/app-context';
import { useAuth } from '@/state/auth-context';
import { OperatorProvider } from '@/state/operator-store';
import { StaffWorkspaceProvider } from '@/state/staff-workspace';
import { OperationsProvider } from '@/state/operations-store';
import { ReceiptPrinterProvider } from '@/features/operator/receipt-printer-provider';

/** See the auth gate in `app/index.tsx` for why these redirects exist. */
export default function StaffLayout() {
  const { isStaffMode } = useAppState();
  const { isAuthenticated, isLoading, operationsEnabled } = useAuth();
  // Both answers below are still loading on a cold open: the session restores
  // asynchronously, and isStaffMode derives from the role the tenant claims
  // carry, which arrives with the portal. Redirecting before either resolves
  // threw a barista opening a board link straight back to sign-in.
  if (isLoading) return <View style={styles.shell}><LoadingState label="Loading the staff workspace…" /></View>;
  if (!isAuthenticated) return <Redirect href="/" />;
  if (!isStaffMode) return <Redirect href="/" />;
  // OperatorProvider sits outside the workspace provider on purpose: the board
  // is this app's reason to exist and reads Supabase directly under staff RLS,
  // so it must not inherit the workspace's failure modes. The tab shell renders
  // unconditionally for the same reason -- screens that need the workspace wrap
  // themselves in `StaffWorkspaceGate` instead.
  //
  // Operations is the exception, and mounting it unconditionally was safe only
  // by accident: the provider held back its reads, and RLS would have denied
  // them anyway. Neither is a gate anyone declared. Since 20260903220000 the
  // capability is an active `workforce-operations` installation, so the mount
  // is that answer -- a brand without the module never constructs the store,
  // and `useOperations()` denies for the screens beneath it. `operationsEnabled`
  // has resolved by the time `isLoading` clears above, so this decides once
  // rather than remounting the store out from under a live session.
  const workspace = (
    <StaffWorkspaceProvider>
      <View style={styles.shell}>
        <StaffTabs />
      </View>
    </StaffWorkspaceProvider>
  );
  return (
    <OperatorProvider>
      <ReceiptPrinterProvider>
        {operationsEnabled
          ? <OperationsProvider>{workspace}</OperationsProvider>
          : workspace}
      </ReceiptPrinterProvider>
    </OperatorProvider>
  );
}

const styles = StyleSheet.create({ shell: { flex: 1 } });
