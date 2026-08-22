import { Tabs } from 'expo-router';

import { BottomNav } from '@/components/bottom-nav';

/**
 * The web build's tab bar. Metro resolves this over `client-tabs.tsx` for any
 * web target (the `.web.tsx` extension wins there, same as `icon.web.tsx`
 * over `icon.tsx`), so `NativeTabs` -- a real `UITabBar` -- never has to run
 * on a platform with no `UITabBar`.
 *
 * `expo-router/unstable-native-tabs` does ship a web renderer, but it draws a
 * plain, unstyled bar with none of this app's brand: no glass, no custom
 * Rewards mark, none of `bottom-nav.tsx`'s polish. `/demo`, the web export of
 * this app, is the client-facing artifact people actually see in a browser
 * (see `mobile-expo-go-demo`), so it keeps the floating glass pill rather than
 * trading it for the generic fallback.
 *
 * The classic `<Tabs>` navigator still owns the route stack underneath --
 * its own bar is just hidden -- so `BottomNav`'s presses, which already go
 * through `useAppState()`'s router-backed `setClientTab`, select the same
 * tabs a native bar would.
 */
export function ClientTabs() {
  return (
    <>
      <Tabs screenOptions={{ headerShown: false, tabBarStyle: { display: 'none' } }} />
      <BottomNav />
    </>
  );
}
