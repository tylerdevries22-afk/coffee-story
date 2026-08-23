import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { ErrorState, LoadingState } from '@/components/ui';
import { useStaffWorkspace } from '@/state/staff-workspace';

/**
 * Holds a screen until the staff workspace has loaded.
 *
 * This gate used to sit in `staff/_layout.tsx`, wrapping the whole tab shell.
 * That made the order board — which does not read the workspace at all — fail
 * to mount whenever the workspace's dashboard fetch did, so a backend unrelated
 * to the board could take the board down with it. It belongs on the screens
 * that actually need the data.
 *
 * Read the workspace inside the children, not around this component: a caller
 * that destructures the context before the gate renders is reading a dashboard
 * that has not arrived yet.
 */
export function StaffWorkspaceGate({ children }: { children: ReactNode }) {
  const { error, loading, reload } = useStaffWorkspace();
  if (loading) {
    return <View style={styles.shell}><LoadingState label="Loading the staff workspace…" /></View>;
  }
  if (error) {
    return <View style={styles.shell}><ErrorState message={error} onRetry={() => void reload()} /></View>;
  }
  return <>{children}</>;
}

const styles = StyleSheet.create({ shell: { flex: 1 } });
