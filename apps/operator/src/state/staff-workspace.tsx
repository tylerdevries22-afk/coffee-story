import { useCallback, useEffect, useMemo, useState, type PropsWithChildren } from 'react';

import { DEMO_OPERATOR_FIXTURES } from '@/data/demo-fixtures';
import {
  DEFAULT_ADMIN_SETTINGS,
  mergeServerStaffSettings,
  serverStaffSettings,
  withBusinessIdentity,
  type AdminSettingsState,
} from '@/features/admin/admin-settings';
import { requestKey, resolvePickupLocations } from '@platform/domain';
import { mobileApi } from '@/lib/mobile-api';
import { useAppState } from '@/state/app-context';
import { useAuth } from '@/state/auth-context';
import { useBusiness } from '@/state/business';
import type { OrderableItem, StaffDashboard } from '@platform/domain';

import { StaffWorkspaceContext, type StaffWorkspaceState } from './staff-workspace-context';
import { useStaffQuickActions } from './staff-quick-actions';
export { useStaffWorkspace } from './staff-workspace-context';

export function StaffWorkspaceProvider({ children }: PropsWithChildren) {
  const { staffDetailPath } = useAppState();
  const { isDemo, brandName, liveLocations } = useAuth();
  const [dashboard, setDashboard] = useState<StaffDashboard>(DEMO_OPERATOR_FIXTURES.staffDashboard);
  const [liveOrderableItems, setLiveOrderableItems] = useState<OrderableItem[]>([]);
  const orderableItems = useMemo(
    () => (isDemo ? [...DEMO_OPERATOR_FIXTURES.orderableItems] : liveOrderableItems),
    [isDemo, liveOrderableItems],
  );

  const pickupLocations = useMemo(
    () => resolvePickupLocations({ identity: { name: brandName }, locations: liveLocations }),
    [brandName, liveLocations],
  );
  const business = useBusiness();
  const [adminSettings, setAdminSettings] = useState<AdminSettingsState>(DEFAULT_ADMIN_SETTINGS);
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [settingsReady, setSettingsReady] = useState(isDemo);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [loading, setLoading] = useState(!isDemo);
  const [error, setError] = useState<string | null>(null);

  const loadDashboard = useCallback(async () => {
    if (isDemo) {
      setDashboard(DEMO_OPERATOR_FIXTURES.staffDashboard);
      setLoading(false);
      return;
    }
    setError(null);
    try {
      setDashboard(await mobileApi.staffDashboard());
    } catch (dashboardError) {
      setError(dashboardError instanceof Error ? dashboardError.message : 'The staff workspace could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [isDemo]);

  useEffect(() => {
    if (isDemo) return;
    void (async () => {
      try {
        const nextDashboard = await mobileApi.staffDashboard();
        setDashboard(nextDashboard);
      } catch (dashboardError) {
        setError(dashboardError instanceof Error ? dashboardError.message : 'The staff workspace could not be loaded.');
      } finally {
        setLoading(false);
      }
    })();
  }, [isDemo]);

  useEffect(() => {
    if (isDemo) return;
    void mobileApi.bookingCatalog()
      .then((catalog) => setLiveOrderableItems(catalog.items))
      .catch(() => setLiveOrderableItems([]));
  }, [isDemo]);

  // The Business Info tab is the brand's own identity, and in live mode that
  // is whoever signed in — not the bundled demo shop the defaults carry.
  useEffect(() => {
    if (isDemo) return;
    setAdminSettings((current) => withBusinessIdentity(current, business));
  }, [business, isDemo]);

  const loadSettings = useCallback(async () => {
    if (isDemo) return;
    setSettingsLoading(true);
    setSettingsReady(false);
    setSettingsError(null);
    try {
      const response = await mobileApi.staffSettings();
      setAdminSettings((current) => mergeServerStaffSettings(current, response.settings));
      setSettingsReady(true);
    } catch (loadError) {
      setSettingsError(loadError instanceof Error ? loadError.message : 'Business settings could not be loaded.');
    } finally {
      setSettingsLoading(false);
    }
  }, [isDemo]);

  useEffect(() => {
    if (staffDetailPath === '/admin/settings' && !isDemo) {
      void Promise.resolve().then(loadSettings);
    }
  }, [isDemo, loadSettings, staffDetailPath]);

  const updateStatus = useCallback(async (
    orderId: string,
    status: 'paid' | 'in_progress' | 'ready' | 'picked_up' | 'cancelled',
  ) => {
    if (isDemo) {
      setDashboard((current) => ({
        ...current,
        orders: current.orders.map((order) => (
          order.id === orderId ? { ...order, status } : order
        )),
      }));
      return;
    }
    await mobileApi.staffAction({
      action: 'order_status',
      orderId,
      status,
      idempotencyKey: `order-status-${orderId}-${status}`,
    });
    await loadDashboard();
  }, [isDemo, loadDashboard]);

  const completeCheckout = useCallback(async (orderId: string) => {
    if (isDemo) {
      setDashboard((current) => ({
        ...current,
        orders: current.orders.map((order) => (
          order.id === orderId ? { ...order, status: 'picked_up' } : order
        )),
      }));
      return;
    }
    await loadDashboard();
  }, [isDemo, loadDashboard]);

  const saveAdminSettings = useCallback(async (next: AdminSettingsState) => {
    setSettingsLoading(true);
    setSettingsError(null);
    try {
      if (isDemo) {
        setAdminSettings(next);
        return;
      }
      const response = await mobileApi.updateStaffSettings(
        serverStaffSettings(next),
        requestKey('staff-settings'),
      );
      setAdminSettings(mergeServerStaffSettings(next, response.settings));
    } finally {
      setSettingsLoading(false);
    }
  }, [isDemo]);

  const quickActionHandlers = useStaffQuickActions({ isDemo, loadDashboard, orderableItems,
    pickupLocations, setDashboard });


  const value = useMemo<StaffWorkspaceState>(() => ({
    dashboard,
    orderableItems,
    loading,
    error,
    reload: loadDashboard,
    updateStatus,
    completeCheckout,
    adminSettings,
    settingsLoading,
    settingsReady,
    settingsError,
    loadSettings,
    saveAdminSettings,
    quickActionHandlers,
  }), [
    adminSettings,
    orderableItems,
    completeCheckout,
    dashboard,
    error,
    loadDashboard,
    loadSettings,
    loading,
    quickActionHandlers,
    saveAdminSettings,
    settingsError,
    settingsLoading,
    settingsReady,
    updateStatus,
  ]);
  return <StaffWorkspaceContext.Provider value={value}>{children}</StaffWorkspaceContext.Provider>;
}
