import { useEffect, useState } from 'react';

/**
 * One-frame-plus delay before the native tab bar mounts.
 *
 * On iOS 26, `UITabBar` lays its labels out before asynchronously-loaded
 * image icons arrive and never recomputes their positions: labels sink below
 * the shared baseline and longer labels truncate with ellipses
 * (react-navigation#12908, react-native-screens#3761 — the latter's
 * `setNeedsLayout` patch landed in react-native-screens 4.26 and does not
 * cover it). Deferring the bar's first mount lets the icon load land inside
 * the initial layout window, and the whole row renders on one baseline.
 * SF-symbol-only bars are unaffected by the race; both of ours carry image
 * marks (the cup and the avatar ring), so both defer. Tapping a tab
 * also repairs the labels, which confirms the cause is layout timing.
 */
export function useDeferredTabBar(): boolean {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setReady(true), 1000);
    return () => clearTimeout(timer);
  }, []);
  return ready;
}
