import { Platform } from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import type { PropsWithChildren } from 'react';

/** Height of the web fallback pill in `components/bottom-nav.tsx`. */
export const WEB_TAB_BAR_HEIGHT = 64;

/**
 * The safe area *inside* a native tab screen, including the tab bar itself.
 *
 * The app's only `SafeAreaProvider` sits at the root, above the tab navigator,
 * so `useSafeAreaInsets()` there reports the window's inset (the home
 * indicator) and knows nothing about the bar. `NativeTabs` also does not
 * publish `BottomTabBarHeightContext`, so `useBottomTabBarHeight()` is
 * unavailable.
 *
 * Mounting a second provider inside the tab screen fixes both: the screen's
 * `UIViewController` is a child of `UITabBarController`, so UIKit has already
 * added the bar's height to that view's safe area, and the nested provider
 * reports it.
 *
 * Wrap a tab screen's root in `<TabScreenSafeArea>` and read the inset from a
 * child component — a hook cannot see a provider its own component renders.
 */
export function TabScreenSafeArea({ children }: PropsWithChildren) {
  return <SafeAreaProvider style={{ flex: 1 }}>{children}</SafeAreaProvider>;
}

/**
 * Bottom clearance for an element pinned above the tab bar.
 *
 * Never hard-code a bar height: it differs between devices, between iOS
 * versions, and shrinks when the iOS 26 bar minimises on scroll. Native
 * reports it through the nested provider above; the web build still draws the
 * floating pill from `components/bottom-nav.tsx`, which is a sibling overlay
 * rather than a real bar, so nothing has added its height to any inset and it
 * has to be paid for explicitly.
 */
export function useTabBarClearance(gap = 10): number {
  const insets = useSafeAreaInsets();
  if (Platform.OS === 'web') return Math.max(insets.bottom, 14) + WEB_TAB_BAR_HEIGHT + gap;
  return insets.bottom + gap;
}
