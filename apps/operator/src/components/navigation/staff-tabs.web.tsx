import { Tabs } from 'expo-router';

import { BottomNav } from '@/components/bottom-nav';

/** Web uses the same router-owned five-item staff bar as native. */
export function StaffTabs() {
  return (
    <Tabs
      tabBar={() => <BottomNav staff />}
      screenOptions={{ headerShown: false }}
    />
  );
}
