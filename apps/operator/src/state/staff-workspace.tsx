import { createContext, useCallback, useContext, useEffect, useMemo, useState, type PropsWithChildren } from 'react';

import { MENU_ITEMS } from '@/data/catalog';
import { DEMO_STAFF } from '@/data/demo';
import type {
  AdminQuickActionHandlers,
  AdminQuickActionSubmission,
} from '@/features/admin/admin-quick-actions';
import {
  DEFAULT_ADMIN_SETTINGS,
  mergeServerStaffSettings,
  serverStaffSettings,
  type AdminSettingsState,
} from '@/features/admin/admin-settings';
import { PICKUP_LOCATIONS, taxCentsFor , requestKey , projectFirstVariants } from '@platform/domain';
import { applyDemoBlockTime, applyDemoGuestNote } from '@/features/staff/dashboard';
import { mobileApi } from '@/lib/mobile-api';
import { useAppState } from '@/state/app-context';
import { useAuth } from '@/state/auth-context';
import type { OrderableItem, StaffDashboard } from '@platform/domain';

/**
 * Everything the staff workspace's screens used to reach through
 * `StaffShell`'s props and local state.
 *
 * The shell doesn't exist anymore -- each tab and each pushed More page is its
 * own route file now, so this data has nowhere to live as component state.
 * `staff/_layout.tsx` mounts the provider once above `<StaffTabs />`, and
 * every staff route reads from it with `useStaffWorkspace()` instead.
 */
type StaffWorkspaceState = {
  dashboard: StaffDashboard;
  orderableItems: OrderableItem[];
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
  updateStatus: (
    orderId: string,
    status: 'paid' | 'in_progress' | 'ready' | 'picked_up' | 'cancelled',
  ) => Promise<void>;
  completeCheckout: (orderId: string) => Promise<void>;
  adminSettings: AdminSettingsState;
  settingsLoading: boolean;
  settingsReady: boolean;
  settingsError: string | null;
  loadSettings: () => Promise<void>;
  saveAdminSettings: (next: AdminSettingsState) => Promise<void>;
  quickActionHandlers: AdminQuickActionHandlers;
};

const StaffWorkspaceContext = createContext<StaffWorkspaceState | null>(null);

const demoOrderableItems: OrderableItem[] = projectFirstVariants(MENU_ITEMS);

export function StaffWorkspaceProvider({ children }: PropsWithChildren) {
  const { staffDetailPath } = useAppState();
  const { isDemo } = useAuth();
  const [dashboard, setDashboard] = useState<StaffDashboard>(DEMO_STAFF);
  const [liveOrderableItems, setLiveOrderableItems] = useState<OrderableItem[]>([]);
  const orderableItems = isDemo || !liveOrderableItems.length ? demoOrderableItems : liveOrderableItems;
  const [adminSettings, setAdminSettings] = useState<AdminSettingsState>(DEFAULT_ADMIN_SETTINGS);
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [settingsReady, setSettingsReady] = useState(isDemo);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [loading, setLoading] = useState(!isDemo);
  const [error, setError] = useState<string | null>(null);

  const loadDashboard = useCallback(async () => {
    if (isDemo) {
      setDashboard(DEMO_STAFF);
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

  const createStaffOrder = useCallback(async (
    submission: Extract<AdminQuickActionSubmission, { kind: 'order' | 'quick-order' }>,
  ) => {
    if (isDemo) {
      const item = orderableItems.find((entry) => entry.slug === submission.itemSlug);
      const placedAt = new Date(submission.startsAt);
      const priceCents = item?.priceCents ?? 0;
      const taxCents = taxCentsFor(priceCents);
      setDashboard((current) => ({
        ...current,
        orders: [...current.orders, {
          id: requestKey('demo-order'),
          status: 'paid',
          summary: submission.itemName,
          lines: [{ name: submission.itemName, quantity: 1, unitPriceCents: priceCents, options: [] }],
          fulfillmentType: 'pickup',
          placedAt: placedAt.toISOString(),
          scheduledFor: new Date(
            placedAt.getTime() + (item?.durationMin ?? 5) * 60_000,
          ).toISOString(),
          subtotalCents: priceCents,
          taxCents,
          tipCents: 0,
          totalCents: priceCents + taxCents,
          note: submission.notes,
          guestLabel: submission.guestName,
        }],
        projectedCents: current.projectedCents + priceCents,
      }));
      return;
    }
    await mobileApi.staffAction({
      action: 'create_order',
      customerId: submission.customerId,
      itemSlug: submission.itemSlug,
      scheduledFor: submission.startsAt,
      // The shop, from the one list that defines it. This carried a literal
      // for a different business entirely -- another tenant's street address
      // under this brand's name, left behind by an earlier product.
      fulfillment: { mode: 'pickup', location: PICKUP_LOCATIONS[0]! },
      notes: submission.notes,
      idempotencyKey: requestKey('staff-order'),
    });
    await loadDashboard();
  }, [orderableItems, isDemo, loadDashboard]);

  const blockStaffTime = useCallback(async (
    submission: Extract<AdminQuickActionSubmission, { kind: 'block-time' }>,
  ) => {
    if (isDemo) {
      setDashboard((current) => applyDemoBlockTime(current, submission, requestKey('demo-block')));
      return;
    }
    await mobileApi.staffAction({
      action: 'block_time',
      startsAt: submission.startsAt,
      endsAt: submission.endsAt,
      reason: submission.reason,
      idempotencyKey: requestKey('staff-block'),
    });
    await loadDashboard();
  }, [isDemo, loadDashboard]);

  const createGuestNote = useCallback(async (
    submission: Extract<AdminQuickActionSubmission, { kind: 'guest-note' }>,
  ) => {
    if (isDemo) {
      setDashboard((current) => applyDemoGuestNote(
        current, submission, requestKey('demo-note'), new Date().toISOString(),
      ));
      return;
    }
    // No live transport yet: the portal that carried staff writes is gone, and
    // the engine's replacement lands with the rest of the live wiring. Reload
    // so the caller never reports a save the dashboard cannot show -- every
    // sibling handler does the same, and there is no pull-to-refresh in this
    // shell, so a stale read only clears on a tab remount.
    await loadDashboard();
  }, [isDemo, loadDashboard]);

  const quickActionHandlers: AdminQuickActionHandlers = useMemo(() => ({
    order: createStaffOrder,
    'quick-order': createStaffOrder,
    'block-time': blockStaffTime,
    'guest-note': createGuestNote,
  }), [blockStaffTime, createStaffOrder, createGuestNote]);

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

export function useStaffWorkspace(): StaffWorkspaceState {
  const state = useContext(StaffWorkspaceContext);
  if (!state) throw new Error('useStaffWorkspace must be used within StaffWorkspaceProvider');
  return state;
}
