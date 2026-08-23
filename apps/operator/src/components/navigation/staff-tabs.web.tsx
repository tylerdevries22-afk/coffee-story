import { Tabs } from 'expo-router';

import { BottomNav } from '@/components/bottom-nav';

/**
 * Web's staff tab bar -- see `staff-tabs.tsx` for the native `UITabBar`.
 *
 * The centred quick-action FAB this used to host booked orders and wrote
 * guest notes; it left with the rest of the booking workspace, so the web bar
 * is now just the pill.
 */
export function StaffTabs() {
  return (
    <>
      <Tabs screenOptions={{ headerShown: false, tabBarStyle: { display: 'none' } }} />
      <BottomNav staff />
    </>
  );
}
