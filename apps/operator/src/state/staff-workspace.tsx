import { createContext, useCallback, useContext, useEffect, useMemo, useState, type PropsWithChildren } from 'react';

import { SERVICES } from '@/data/catalog';
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
import { PICKUP_LOCATIONS } from '@/features/order/fulfillment';
import { requestKey } from '@/features/order/request-key';
import { projectFirstServices } from '@/features/booking/service-projections';
import { applyDemoBlockTime, applyDemoSoapNote } from '@/features/staff/dashboard';
import { mobileApi } from '@/lib/mobile-api';
import { useAppState } from '@/state/app-context';
import { useAuth } from '@/state/auth-context';
import type { BookingService, StaffDashboard } from '@/types/domain';

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
  bookingServices: BookingService[];
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
  updateStatus: (appointmentId: string, status: 'confirmed' | 'cancelled' | 'no_show') => Promise<void>;
  completeCheckout: (appointmentId: string) => Promise<void>;
  adminSettings: AdminSettingsState;
  settingsLoading: boolean;
  settingsReady: boolean;
  settingsError: string | null;
  loadSettings: () => Promise<void>;
  saveAdminSettings: (next: AdminSettingsState) => Promise<void>;
  quickActionHandlers: AdminQuickActionHandlers;
};

const StaffWorkspaceContext = createContext<StaffWorkspaceState | null>(null);

const demoBookingServices: BookingService[] = projectFirstServices(SERVICES);

export function StaffWorkspaceProvider({ children }: PropsWithChildren) {
  const { staffDetailPath } = useAppState();
  const { isDemo } = useAuth();
  const [dashboard, setDashboard] = useState<StaffDashboard>(DEMO_STAFF);
  const [liveBookingServices, setLiveBookingServices] = useState<BookingService[]>([]);
  const bookingServices = isDemo || !liveBookingServices.length ? demoBookingServices : liveBookingServices;
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
      .then((catalog) => setLiveBookingServices(catalog.services))
      .catch(() => setLiveBookingServices([]));
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

  const updateStatus = useCallback(async (appointmentId: string, status: 'confirmed' | 'cancelled' | 'no_show') => {
    if (isDemo) {
      setDashboard((current) => ({
        ...current,
        appointments: current.appointments.map((appointment) => (
          appointment.id === appointmentId ? { ...appointment, status } : appointment
        )),
      }));
      return;
    }
    await mobileApi.staffAction({
      action: 'appointment_status',
      appointmentId,
      status,
      idempotencyKey: `appointment-status-${appointmentId}-${status}`,
    });
    await loadDashboard();
  }, [isDemo, loadDashboard]);

  const completeCheckout = useCallback(async (appointmentId: string) => {
    if (isDemo) {
      setDashboard((current) => ({
        ...current,
        appointments: current.appointments.map((appointment) => (
          appointment.id === appointmentId ? { ...appointment, status: 'completed' } : appointment
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

  const createStaffAppointment = useCallback(async (
    submission: Extract<AdminQuickActionSubmission, { kind: 'book' | 'quick-book' }>,
  ) => {
    if (isDemo) {
      const service = bookingServices.find((item) => item.slug === submission.serviceSlug);
      const startsAt = new Date(submission.startsAt);
      const endsAt = new Date(startsAt.getTime() + (service?.durationMin ?? 60) * 60_000);
      setDashboard((current) => ({
        ...current,
        appointments: [...current.appointments, {
          id: requestKey('demo-appointment'),
          serviceName: submission.serviceName,
          startsAt: startsAt.toISOString(),
          endsAt: endsAt.toISOString(),
          status: 'confirmed',
          subtotalCents: service?.priceCents ?? 0,
          depositCents: 0,
          balanceCents: service?.priceCents ?? 0,
          clientName: submission.clientName,
        }],
        projectedCents: current.projectedCents + (service?.priceCents ?? 0),
      }));
      return;
    }
    await mobileApi.staffAction({
      action: 'create_appointment',
      customerId: submission.customerId,
      serviceSlug: submission.serviceSlug,
      startsAt: submission.startsAt,
      // The shop, from the one list that defines it. This carried a literal
      // for a different business entirely -- another tenant's street address
      // under this brand's name, left behind by an earlier product.
      fulfillment: { mode: 'pickup', location: PICKUP_LOCATIONS[0]! },
      notes: submission.notes,
      idempotencyKey: requestKey('staff-booking'),
    });
    await loadDashboard();
  }, [bookingServices, isDemo, loadDashboard]);

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

  const createStaffSoapNote = useCallback(async (
    submission: Extract<AdminQuickActionSubmission, { kind: 'soap' }>,
  ) => {
    if (isDemo) {
      setDashboard((current) => applyDemoSoapNote(current, submission, requestKey('demo-soap'), new Date().toISOString()));
      return;
    }
    await mobileApi.staffAction({
      action: 'soap_note',
      customerId: submission.customerId,
      serviceName: submission.serviceName,
      treatmentDate: submission.treatmentDate,
      subjective: submission.subjective,
      objective: submission.objective,
      assessment: submission.assessment,
      plan: submission.plan,
      focusAreas: [],
      idempotencyKey: requestKey('staff-soap'),
    });
    // Every sibling live handler reloads here. Without it the FAB still reports
    // "The SOAP note is saved to the client record." while soapNotesForClient
    // reads the stale dashboard, so the therapist opens that client and the note
    // is absent -- and there is no pull-to-refresh in this shell, so only a tab
    // remount recovers it.
    await loadDashboard();
  }, [isDemo, loadDashboard]);

  const quickActionHandlers: AdminQuickActionHandlers = useMemo(() => ({
    book: createStaffAppointment,
    'quick-book': createStaffAppointment,
    'block-time': blockStaffTime,
    soap: createStaffSoapNote,
  }), [blockStaffTime, createStaffAppointment, createStaffSoapNote]);

  const value = useMemo<StaffWorkspaceState>(() => ({
    dashboard,
    bookingServices,
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
    bookingServices,
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
