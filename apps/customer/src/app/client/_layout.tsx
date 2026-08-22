import { Redirect } from 'expo-router';
import { View, StyleSheet } from 'react-native';

import { ClientTabs } from '@/components/navigation/client-tabs';
import { LoadingState } from '@/components/ui';
import { useAppState } from '@/state/app-context';
import { useAuth } from '@/state/auth-context';

/**
 * Guards against a stale URL: a role switch (`selectRole`) or entering/exiting
 * staff mode replaces to the other shell's root, but a deep link or a
 * `router.back()` landing here after that switch could still resolve to
 * `/client` while `isStaffMode` is now true.
 */
export default function ClientLayout() {
  const { isStaffMode } = useAppState();
  const { isAuthenticated, isLoading } = useAuth();
  // Nothing is decidable until the session is restored: on a live account
  // that restore is async, so a deep link opened cold (a push notification,
  // a shared link, a browser reload) arrived here with isAuthenticated still
  // false and got bounced to the gate, losing the destination the guest was
  // actually opening. Wait for the answer before acting on it.
  if (isLoading) return <LoadingState label="Preparing your private portal" />;
  // `app/index.tsx` is the app's only auth gate, and it unmounts the moment it
  // redirects here -- so anything that ends a session from inside the shell
  // (signing out, or switching from Demo to live) left the guest browsing the
  // tabs against an empty portal: no name, no Beans, no orders.
  if (!isAuthenticated) return <Redirect href="/" />;
  if (isStaffMode) return <Redirect href="/" />;
  return (
    <View style={styles.shell}>
      <ClientTabs />
    </View>
  );
}

const styles = StyleSheet.create({ shell: { flex: 1 } });
