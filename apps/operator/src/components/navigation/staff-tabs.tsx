import { NativeTabs, TabIcon, TabLabel } from '@/components/navigation/native-tabs-compat';
import { useDeferredTabBar } from '@/components/navigation/use-deferred-tab-bar';
import { useTabAvatar } from '@/lib/tab-avatar';
import { STAFF_TAB_LABELS } from '@/state/navigation-state';
import { useAuth } from '@/state/auth-context';
import { colors } from '@/theme/tokens';

/**
 * The staff bottom bar, on the same real `UITabBar` as the client one — see
 * `client-tabs.tsx` for why the hand-rolled pill was replaced.
 *
 * The quick-action `+` is a genuine tab here rather than the floating button
 * it used to be. A `UITabBar` has no way to host a control between its items,
 * and `tabPress` on native tabs cannot be prevented (react-native-screens
 * reports the selection after the fact), so the plus has to resolve to a real
 * destination: `quick-actions` is a route that opens the speed dial and
 * returns to the previous tab when dismissed.
 *
 * Checkout is deliberately not here — see `STAFF_TAB_ORDER`.
 */
export function StaffTabs() {
  // See useDeferredTabBar: the avatar image must not race the bar's first
  // label layout on iOS 26.
  const deferred = useDeferredTabBar();
  const { portal } = useAuth();
  const avatar = useTabAvatar(portal.profile.avatarUrl);
  if (!deferred || !avatar.ready) return null;
  return (
    <NativeTabs
      tintColor={colors.brand700}
      iconColor={colors.ink500}
      blurEffect="systemChromeMaterial"
    >
      <NativeTabs.Trigger name="orders">
        <TabIcon sf={{ default: 'rectangle.grid.2x2', selected: 'rectangle.grid.2x2.fill' }} />
        <TabLabel>{STAFF_TAB_LABELS.orders}</TabLabel>
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="today">
        <TabIcon sf={{ default: 'sun.max', selected: 'sun.max.fill' }} />
        <TabLabel>{STAFF_TAB_LABELS.today}</TabLabel>
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="calendar">
        <TabIcon sf="calendar" />
        <TabLabel>{STAFF_TAB_LABELS.calendar}</TabLabel>
      </NativeTabs.Trigger>

      {/* Tinted brand even when unselected: this is the workspace's primary
          action, and a muted plus reads as just another destination. */}
      <NativeTabs.Trigger name="quick-actions" disablePopToTop>
        <TabIcon
          sf={{ default: 'plus.circle.fill', selected: 'plus.circle.fill' }}
          selectedColor={colors.brand700}
        />
        <TabLabel>{STAFF_TAB_LABELS['quick-actions']}</TabLabel>
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="clients">
        <TabIcon sf={{ default: 'person.2', selected: 'person.2.fill' }} />
        <TabLabel>{STAFF_TAB_LABELS.clients}</TabLabel>
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
