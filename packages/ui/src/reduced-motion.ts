/**
 * Whether the guest has asked the OS for less motion.
 *
 * Promoted here from twin copies in `apps/customer/src/hooks/` and
 * `apps/operator/src/hooks/`. The kiosk needed a third, which is the point at
 * which CLAUDE.md's transitional note says to stop copying and move it into a
 * package.
 *
 * Subscribed, not read once: someone toggling the setting mid-session is
 * exactly the person who most needs it to take effect.
 */
import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    let alive = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((value) => {
      if (alive) setReduced(value);
    });
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced);
    return () => {
      alive = false;
      subscription.remove();
    };
  }, []);
  return reduced;
}
