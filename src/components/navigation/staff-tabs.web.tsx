import { Tabs } from 'expo-router';
import { useState } from 'react';

import { BottomNav } from '@/components/bottom-nav';
import { StaffQuickActionFab } from '@/components/staff-quick-action-fab';
import { useAppState } from '@/state/app-context';
import { useAuth } from '@/state/auth-context';
import { useStaffWorkspace } from '@/state/staff-workspace';

/**
 * Web's staff tab bar -- see `client-tabs.web.tsx` for why this file exists.
 *
 * Native's quick-action `+` is a real tab (`staff-tabs.tsx`); the web pill has
 * no bar item to spare for a floating control the way a `UITabBar` cannot
 * host one either, so it keeps the centred FAB `StaffShell` used to draw,
 * unchanged in behaviour.
 */
export function StaffTabs() {
  const [quickActionsOpen, setQuickActionsOpen] = useState(false);
  const { setStaffTab } = useAppState();
  const { isDemo } = useAuth();
  const { bookingServices, dashboard, quickActionHandlers } = useStaffWorkspace();

  return (
    <>
      <Tabs screenOptions={{ headerShown: false, tabBarStyle: { display: 'none' } }} />
      <BottomNav staff onQuickActions={() => setQuickActionsOpen(true)} />
      <StaffQuickActionFab
        open={quickActionsOpen}
        onOpenChange={setQuickActionsOpen}
        onQuickBook={() => {
          setQuickActionsOpen(false);
          setStaffTab('checkout');
        }}
        clients={dashboard.clients}
        services={bookingServices}
        handlers={quickActionHandlers}
        isDemo={isDemo}
      />
    </>
  );
}
