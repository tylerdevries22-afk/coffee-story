import { NativeTabs, TabIcon, TabLabel } from '@/components/navigation/native-tabs-compat';
import { useDeferredTabBar } from '@/components/navigation/use-deferred-tab-bar';
import { useTabAvatar } from '@/lib/tab-avatar';
import { CLIENT_TAB_LABELS } from '@/state/navigation-state';
import { useAuth } from '@/state/auth-context';
import { colors } from '@/theme/tokens';

import rewardsCup from '../../../assets/tabs/cup.png';

/**
 * The client bottom bar is a real `UITabBar`, not a JavaScript replica.
 *
 * `NativeTabs` renders one through react-native-screens, which is what gives
 * us SF Symbols, system label typography, scroll-edge transparency and — on
 * iOS 26 — Liquid Glass. The previous implementation was a 64pt floating glass
 * pill with hand-drawn 10pt labels; this matches the platform instead of
 * imitating it, and two behaviours come free that the pill never had: tapping
 * the active tab pops its stack to the root and scrolls to top, and the bar
 * tracks scroll position to fade its material at the content edge.
 *
 * The web build keeps the pill — see `client-tabs.web.tsx`.
 */
export function ClientTabs() {
  // See useDeferredTabBar: mounting after the first layout window is what
  // keeps the labels on one baseline while the two image icons load. The
  // avatar hook gates the same mount while a freshly chosen photo is cropped.
  const deferred = useDeferredTabBar();
  const { portal } = useAuth();
  const avatar = useTabAvatar(portal.profile.avatarUrl);
  if (!deferred || !avatar.ready) return null;
  return (
    <NativeTabs
      // The UIKit equivalent of SwiftUI's .tint(): sets the selected item's
      // icon and label colour in one place.
      tintColor={colors.brand700}
      iconColor={colors.ink500}
      // No labelStyle on purpose. Supplying a fontFamily without a size drops
      // the compact metric UIKit uses for tab labels, and they render at body
      // size and collide. System typography is the point of using the real
      // control. Leaving backgroundColor unset keeps the system material
      // rather than painting over it, which is what allows the bar to go
      // transparent at the scroll edge and to render as Liquid Glass on
      // iOS 26; setting minimizeBehavior or disableTransparentOnScrollEdge
      // would opt out of the platform behaviour we are matching.
      blurEffect="systemChromeMaterial"
    >
      <NativeTabs.Trigger name="home">
        <TabIcon sf={{ default: 'house', selected: 'house.fill' }} />
        <TabLabel>{CLIENT_TAB_LABELS.home}</TabLabel>
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="gift">
        <TabIcon sf={{ default: 'gift', selected: 'gift.fill' }} />
        <TabLabel>{CLIENT_TAB_LABELS.gift}</TabLabel>
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="book">
        <TabIcon sf={{ default: 'cup.and.saucer', selected: 'cup.and.saucer.fill' }} />
        <TabLabel>{CLIENT_TAB_LABELS.book}</TabLabel>
      </NativeTabs.Trigger>

      {/* The one mark with no SF Symbol equivalent. expo-router hands UIKit
          only a symbol name or an image, so the drawn hand-and-heart ships as
          a template PNG built by scripts/build-mobile-tab-icons.mjs from the
          same paths react-native-svg draws elsewhere in the app. */}
      <NativeTabs.Trigger name="rewards">
        <TabIcon src={rewardsCup} />
        <TabLabel>{CLIENT_TAB_LABELS.rewards}</TabLabel>
      </NativeTabs.Trigger>

      {/* The user's own photo once they've picked one (circle-cropped by
          useTabAvatar, rendered original so it keeps its colours), otherwise
          the monogram ring — template-tinted like the four symbols. The
          "Profile" label sits below either way. */}
      <NativeTabs.Trigger name="more">
        <TabIcon src={avatar.source} renderingMode={avatar.isPhoto ? 'original' : 'template'} />
        <TabLabel>Profile</TabLabel>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
