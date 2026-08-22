import { Redirect } from 'expo-router';
import { View, StyleSheet } from 'react-native';

import { ClientTabs } from '@/components/navigation/client-tabs';
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
  const { isAuthenticated } = useAuth();
  // `app/index.tsx` is the app's only auth gate, and it unmounts the moment it
  // redirects here -- so anything that ends a session from inside the shell
  // (signing out, or switching from Demo to live) left the guest browsing the
  // tabs against an empty portal: no name, no Beans, no orders.
  if (!isAuthenticated) return <Redirect href="/" />;
  if (isStaffMode) return <Redirect href="/staff" />;
  return (
    <View style={styles.shell}>
      <ClientTabs />
    </View>
  );
}

const styles = StyleSheet.create({ shell: { flex: 1 } });
