import { router } from 'expo-router';
import { useState } from 'react';

import { StaffQuickActionFab } from '@/components/staff-quick-action-fab';
import { TabScreenSafeArea, useTabBarClearance } from '@/components/navigation/tab-screen';
import { useAuth } from '@/state/auth-context';
import { useStaffWorkspace } from '@/state/staff-workspace';

/**
 * The staff bar's centred `+`, as a real tab rather than a floating button.
 *
 * `UITabBar` has no slot for a control between its items, and native tab
 * presses cannot be intercepted (react-native-screens reports the selection
 * after the fact, it cannot be prevented) -- so the plus has to resolve to an
 * actual destination. Selecting this tab opens the same speed dial and sheet
 * `StaffShell` used to own, presented as a real `<Modal>` (see
 * `SheetModal`), which floats above the tab bar regardless of which tab
 * "selected" underneath it. Dismissing it -- an action chosen, or the
 * backdrop tapped -- always lands on Today; the plus has no state of its own
 * to return to, unlike a tab a user actually chose to view.
 */
export default function StaffQuickActionsRoute() {
  const [open, setOpen] = useState(true);
  const { isDemo } = useAuth();
  const { bookingServices, dashboard, quickActionHandlers } = useStaffWorkspace();
  // A small gap above the real bar rather than the web FAB's default, which
  // clears a floating pill this screen doesn't have -- see the prop's comment.
  const clearance = useTabBarClearance(24);

  return (
    <TabScreenSafeArea>
      <StaffQuickActionFab
        open={open}
        bottomOffset={clearance}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) router.replace('/staff/today');
        }}
        onQuickBook={() => {
          setOpen(false);
          router.replace('/staff/more/checkout');
        }}
        clients={dashboard.clients}
        services={bookingServices}
        handlers={quickActionHandlers}
        isDemo={isDemo}
      />
    </TabScreenSafeArea>
  );
}
