import { createContext, useCallback, useContext, useEffect, useMemo, useState, type PropsWithChildren } from 'react';

import { DEMO_OPERATOR_FIXTURES } from '@/data/demo-fixtures';
import type {
  AdminQuickActionHandlers,
  AdminQuickActionSubmission,
} from '@/features/admin/admin-quick-actions';
import {
  DEFAULT_ADMIN_SETTINGS,
  mergeServerStaffSettings,
  serverStaffSettings,
  withBusinessIdentity,
  type AdminSettingsState,
} from '@/features/admin/admin-settings';
import { requestKey, resolvePickupLocations, taxCentsFor } from '@platform/domain';
import { applyDemoBlockTime, applyDemoGuestNote } from '@/features/staff/dashboard';
import { mobileApi } from '@/lib/mobile-api';
import { useAppState } from '@/state/app-context';
import { useAuth } from '@/state/auth-context';
import { useBusiness } from '@/state/business';
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

export function StaffWorkspaceProvider({ children }: PropsWithChildren) {
  const { staffDetailPath } = useAppState();
  const { isDemo, brandName, liveLocations } = useAuth();
  const [dashboard, setDashboard] = useState<StaffDashboard>(DEMO_OPERATOR_FIXTURES.staffDashboard);
  const [liveOrderableItems, setLiveOrderableItems] = useState<OrderableItem[]>([]);
  // Demo only. The bundled catalogue is the launch shop's menu, and one
  // listing serves every tenant (rule 7), so standing it in whenever the live
  // read came back empty offered a second brand's staff 61 items that brand
  // does not sell -- against slugs its own menu has never heard of. An empty
  // list is the honest answer while the live catalogue has no schema behind
  // it; the screens say so rather than substituting.
  const orderableItems = useMemo(
    () => (isDemo ? [...DEMO_OPERATOR_FIXTURES.orderableItems] : liveOrderableItems),
    [isDemo, liveOrderableItems],
  );

  /**
   * The shops this signed-in brand collects from.
   *
   * One listing serves every tenant (rule 7), so the pickup location is a
   * runtime answer read from the location rows the staff context already
   * loaded. It used to be a constant in the shared engine holding one brand's
   * street address, which meant a staff order taken at any other shop was
   * filed against an address in Aurora.
   */
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

  const createStaffOrder = useCallback(async (
    submission: Extract<AdminQuickActionSubmission, { kind: 'order' | 'quick-order' }>,
  ) => {
    if (isDemo) {
      const item = orderableItems.find((entry) => entry.slug === submission.itemSlug);
      const placedAt = new Date(submission.startsAt);
      const priceCents = item?.priceCents ?? 0;
      const taxCents = taxCentsFor(priceCents, DEMO_OPERATOR_FIXTURES.taxJurisdictions);
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
    // Fail before the order exists rather than after: a staff order needs a
    // shop to be collected from, and there is nothing honest to substitute.
    const [pickupLocation] = pickupLocations;
    if (!pickupLocation) {
      throw new Error('This shop has no location with a posted address yet. Add one in HQ first.');
    }
    await mobileApi.staffAction({
      action: 'create_order',
      customerId: submission.customerId,
      itemSlug: submission.itemSlug,
      scheduledFor: submission.startsAt,
      fulfillment: { mode: 'pickup', location: pickupLocation },
      notes: submission.notes,
      idempotencyKey: requestKey('staff-order'),
    });
    await loadDashboard();
  }, [orderableItems, isDemo, loadDashboard, pickupLocations]);

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
