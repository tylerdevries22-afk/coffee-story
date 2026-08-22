import { CheckoutScreen } from '@/screens/staff/checkout-screen';
import { useAppState } from '@/state/app-context';
import { useStaffWorkspace } from '@/state/staff-workspace';

/**
 * Point of sale, reached from the quick-action `+` and from the web portal's
 * `/admin/pos` (via `openStaffDestination`) -- see `STAFF_TAB_ORDER`'s
 * comment in `navigation-state.ts` for why this is a pushed page under More
 * rather than a sixth tab.
 *
 * `CheckoutScreen` never drew its own exit affordance: it used to be reached
 * by tapping a peer tab and left the same way, by tapping another one. The
 * `onBack` prop renders the same "Back to More" row every other pushed page
 * in this stack already has, inside the screen's own padded scroll view.
 * `closeStaffDestination` (not `openMore`, which is the client shell's
 * helper) pops back to whatever pushed this -- the More menu when reached
 * from the admin directory, or Today when reached from the quick-action
 * sheet's Quick Book, which replaces rather than pushes.
 */
export default function StaffMoreCheckoutRoute() {
  const { closeStaffDestination } = useAppState();
  const { dashboard, completeCheckout } = useStaffWorkspace();
  return (
    <CheckoutScreen
      appointments={dashboard.appointments}
      onComplete={completeCheckout}
      promptForTip={dashboard.promptForTip ?? true}
      onBack={closeStaffDestination}
    />
  );
}
