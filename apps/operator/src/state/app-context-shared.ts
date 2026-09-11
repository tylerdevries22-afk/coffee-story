import * as Haptics from 'expo-haptics';
import { router, type Href } from 'expo-router';
import { createContext } from 'react';

import type { AppRole } from '@platform/domain';

import type { ClientTab, MoreView, StaffTab } from '@/state/navigation-state';

export type AppState = {
  role: AppRole;
  isStaffMode: boolean;
  clientTab: ClientTab;
  staffTab: StaffTab;
  selectedServiceId: string | null;
  giftClaimToken: string | null;
  moreView: MoreView;
  staffDetailPath: string | null;
  setupPromptRole: AppRole | null;
  queueSetupPrompt: (role: AppRole) => void;
  dismissSetupPrompt: () => void;
  readNotificationIds: ReadonlySet<string>;
  unreadNotificationIds: ReadonlySet<string>;
  openNotifications: (visibleIds: readonly string[]) => void;
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

export const AppContext = createContext<AppState | null>(null);

export function selectionFeedback() {
  void Haptics.selectionAsync().catch(() => undefined);
}

export function go(href: string, mode: 'navigate' | 'push' | 'replace' | 'dismissTo' = 'navigate') {
  router[mode](href as Href);
}
