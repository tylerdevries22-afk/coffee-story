import { useEffect } from 'react';

import { useFlow } from '@/state/flow';
import { useKioskSession } from '@/state/session';

/**
 * Compatibility route for an old `/bag` link.
 *
 * Cart review is a right-side drawer now. Keeping this redirect means an
 * installed kiosk returning from stale navigation state cannot resurrect the
 * former full-screen bag.
 */
export default function BagStep() {
  const { cart } = useKioskSession();
  const { goTo, openCart } = useFlow();

  useEffect(() => {
    goTo('entry');
    if (cart.lines.length > 0) openCart();
  }, [cart.lines.length, goTo, openCart]);

  return null;
}
