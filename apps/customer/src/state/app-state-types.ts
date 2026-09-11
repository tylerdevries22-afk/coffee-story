import type { AppRole } from '@platform/domain';
import type { ClientTab, MoreView, StaffTab } from './navigation-state';

export type AppState = {
  role: AppRole;
  isStaffMode: boolean;
  clientTab: ClientTab;
  staffTab: StaffTab;
  selectedServiceId: string | null;
  giftClaimToken: string | null;
  moreView: MoreView;
  staffDetailPath: string | null;
  /** Everything seen so far this session; drives the header badge count. */
  readNotificationIds: ReadonlySet<string>;
  /**
   * What was still unread the moment the page opened. Instagram keeps those
   * rows highlighted for the duration of the order even though the badge
   * clears immediately, so the highlight reads from this snapshot rather than
   * from the live read set.
   */
  unreadNotificationIds: ReadonlySet<string>;
  openNotifications: (visibleIds: readonly string[]) => void;
  /**
   * True while a full-screen flow page covers the tab bar (the order flow's
   * setup and checkout pages). Native pages simply draw over the native bar;
   * the web bar is a sibling layer that cannot be painted over from inside
   * the screen subtree (react-native-web gives every View z-index: 0), so it
   * hides itself on this signal instead.
   */
  barCovered: boolean;
  setBarCovered: (covered: boolean) => void;
  closeNotifications: () => void;
  setClientTab: (tab: ClientTab) => void;
  setStaffTab: (tab: StaffTab) => void;
  startOrder: (itemId?: string) => void;
  consumeGiftClaimToken: () => void;
  openMore: (view: MoreView) => void;
  enterStaff: () => void;
  exitStaff: () => void;
  selectRole: (role: AppRole) => void;
  openStaffDestination: (path: string) => void;
  closeStaffDestination: () => void;
};
