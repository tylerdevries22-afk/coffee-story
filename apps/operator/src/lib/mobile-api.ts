/**
 * The operator app's live-mode data seam. The board itself never comes here
 * — it reads and writes under staff RLS in state/operator-store — but the
 * workspace screens still call these named methods.
 *
 * staffDashboard is served from the live plane (today's orders at the
 * claimed locations). The order-era surfaces (bookings, preferences forms,
 * staff checkout, avatars) have no live schema behind them yet: they throw a
 * 501 MobileApiError with an honest message instead of pretending, and their
 * screens catch it. The legacy orders host is gone.
 */
import type { IntakeFormCatalogEntry } from '@/features/admin/preferences-forms';
import { staffRevenueMetrics } from '@/features/staff/revenue';
import { supabase } from '@/lib/supabase';
import { tenantClaimsFromSession } from '@/lib/live-portal';
import { fetchPublishedTrainingRelease } from '@platform/data';
import type {
  OrderableCatalog,
  PortalProfile,
  StaffDashboard,
  StaffSettings,
  StaffActionPayload,
  TrainingManifest,
} from '@platform/domain';
import { parseTenantClaims } from '@platform/schema';

export class MobileApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(message: string, status = 500, code = 'mobile_api_error') {
    super(message);
    this.name = 'MobileApiError';
    this.status = status;
    this.code = code;
  }
}

function notAvailable(what: string): never {
  throw new MobileApiError(`${what} is coming to live accounts soon. It works fully in Demo.`, 501, 'not_available');
}

/** Local midnight, so "today" on the dashboard matches the shop's day. */
function startOfToday(): string {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return now.toISOString();
}

export const mobileApi = {
  trainingRelease: async (): Promise<{ id: string; manifest: TrainingManifest } | null> => {
    if (!supabase) throw new MobileApiError('Live mode is not configured in this build.', 503, 'configuration_missing');
    const session = await supabase.auth.getSession();
    const claims = session.data.session ? tenantClaimsFromSession(session.data.session) : null;
    if (!claims?.role) throw new MobileApiError('This account has no tenant training access.', 403, 'no_staff_access');
    try {
      return await fetchPublishedTrainingRelease(supabase, claims.brand_id);
    } catch {
      throw new MobileApiError('Training could not be loaded.', 500, 'load_failed');
    }
  },
  /**
   * The workspace headline, from the live plane: today's orders at the
   * locations this staff JWT may see (RLS scopes the select).
   */
  staffDashboard: async (): Promise<StaffDashboard> => {
    if (!supabase) {
      throw new MobileApiError('Live mode is not configured in this build.', 503, 'configuration_missing');
    }
    const session = await supabase.auth.getSession();
    const token = session.data.session?.access_token;
    const payload = token ? JSON.parse(
      typeof atob === 'function'
        ? atob((token.split('.')[1] ?? '').replace(/-/g, '+').replace(/_/g, '/'))
        : Buffer.from(token.split('.')[1] ?? '', 'base64').toString('utf8'),
    ) as { app_metadata?: unknown } : null;
    const claims = payload ? parseTenantClaims(payload.app_metadata) : null;
    if (!claims?.role) {
      throw new MobileApiError('This account has no staff access at this shop.', 403, 'no_staff_access');
    }
    const orders = await supabase
      .from('orders')
      .select('status, total_cents, created_at')
      .eq('brand_id', claims.brand_id)
      .gte('created_at', startOfToday())
      .returns<{ status: string; total_cents: number; created_at: string }[]>();
    if (orders.error) {
      throw new MobileApiError(`Today's orders could not be loaded: ${orders.error.message}`, 500, 'load_failed');
    }
    const rows = orders.data ?? [];
    const metrics = staffRevenueMetrics(rows);
    return {
      orders: [],
      clients: [],
      projectedCents: metrics.revenueCents,
      openMinutes: 0,
      metrics: {
        todayRevenueCents: metrics.revenueCents,
        orderCount: metrics.orderCount,
        newClientCount: 0,
        rebookRatePct: 0,
      },
    };
  },

  // ---- Order-era surfaces with no live schema behind them yet ----
  // Typed to their legacy shapes so the screens keep compiling; the
  // implementations only ever throw, and the screens catch.
  staffSettings: async (): Promise<{ settings: StaffSettings }> => notAvailable('Workspace settings'),
  updateStaffSettings: async (_settings: StaffSettings, _key: string): Promise<{ settings: StaffSettings }> =>
    notAvailable('Workspace settings'),
  staffAction: async (_payload: StaffActionPayload): Promise<{ ok: true; targetId: string }> =>
    notAvailable('Booking actions'),
  bookingCatalog: async (): Promise<OrderableCatalog> => notAvailable('The booking catalog'),
  createStaffCheckout: async (_payload: { orderId: string; tipCents: number; idempotencyKey: string }): Promise<{
    paymentIntent: string;
    ephemeralKey: string;
    customer: string;
  }> => notAvailable('Card checkout'),
  intakeForms: async (): Promise<{ forms: IntakeFormCatalogEntry[] }> => notAvailable('Preferences forms'),
  updateIntakeForms: async (_forms: readonly IntakeFormCatalogEntry[]): Promise<{ forms: IntakeFormCatalogEntry[] }> =>
    notAvailable('Preferences forms'),
  updateProfile: async (
    _payload: Pick<PortalProfile, 'fullName' | 'phone' | 'birthday'>,
    _key: string,
  ): Promise<{ profile: PortalProfile }> => notAvailable('Profile edits'),
  uploadProfileAvatar: async (_photo: Blob, _mimeType: string, _key: string): Promise<{ profile: PortalProfile }> =>
    notAvailable('Profile photos'),
  updateIntake: async (_payload: unknown, _key: string): Promise<{ ok: true }> => notAvailable('Preferences'),
  submitIntake: async (_payload: unknown, _key: string): Promise<{ ok: true }> => notAvailable('Preferences'),
};
