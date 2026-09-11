import { createContext, useContext } from 'react';

import type { AdminQuickActionHandlers } from '@/features/admin/admin-quick-actions';
import type { AdminSettingsState } from '@/features/admin/admin-settings';
import type { OrderableItem, StaffDashboard } from '@platform/domain';

export type StaffWorkspaceState = {
  dashboard: StaffDashboard;
  orderableItems: OrderableItem[];
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
  updateStatus: (orderId: string,
    status: 'paid' | 'in_progress' | 'ready' | 'picked_up' | 'cancelled') => Promise<void>;
  completeCheckout: (orderId: string) => Promise<void>;
  adminSettings: AdminSettingsState;
  settingsLoading: boolean;
  settingsReady: boolean;
  settingsError: string | null;
  loadSettings: () => Promise<void>;
  saveAdminSettings: (next: AdminSettingsState) => Promise<void>;
  quickActionHandlers: AdminQuickActionHandlers;
};

export const StaffWorkspaceContext = createContext<StaffWorkspaceState | null>(null);

export function useStaffWorkspace(): StaffWorkspaceState {
  const state = useContext(StaffWorkspaceContext);
  if (!state) throw new Error('useStaffWorkspace must be used within StaffWorkspaceProvider');
  return state;
}
