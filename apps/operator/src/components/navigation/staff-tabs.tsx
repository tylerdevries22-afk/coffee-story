import { Tabs } from 'expo-router';

import { BottomNav } from '@/components/bottom-nav';

/**
 * Staff uses one custom bar everywhere. Native UITabBar turns a sixth route
 * into an overflow item and cannot keep the screenshot's flat five-item
 * layout, while the router remains the source of truth for tab state.
 */
export function StaffTabs() {
  return (
    <Tabs
      tabBar={() => <BottomNav staff />}
      screenOptions={{ headerShown: false }}
    />
  );
}
