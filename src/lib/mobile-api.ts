import type { IntakeFormCatalogEntry } from '@/features/admin/intake-forms';
import { fetchWithRetry } from '@/lib/network';
import { resolvePortalUrl } from '@/lib/portal-url';
import { supabase } from '@/lib/supabase';
import type { BookingFulfillment } from '@/features/booking/fulfillment';
import type {
  BookingCatalog,
  IntakeProfile,
  PortalBundle,
  PortalMessage,
  PortalProfile,
  RewardReferral,
  StaffActionPayload,
  StaffDashboard,
  StaffSettings,
} from '@/types/domain';

type ApiErrorBody = { error?: { code?: string; message?: string } | string };

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

async function authorizationHeader(): Promise<Record<string, string>> {
  const session = await supabase?.auth.getSession();
  const token = session?.data.session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function requestJson<T>(
  path: string,
  init: RequestInit = {},
  authenticated = true,
  timeoutMs?: number,
): Promise<T> {
  const authHeaders = authenticated ? await authorizationHeader() : {};
  let requestUrl: string;
  try {
    requestUrl = resolvePortalUrl(path);
  } catch {
    throw new MobileApiError('The production API URL is not configured securely.', 503, 'configuration_missing');
  }
  const response = await fetchWithRetry(
    requestUrl,
    {
      ...init,
      headers: {
        Accept: 'application/json',
        ...authHeaders,
        ...init.headers,
      },
    },
    timeoutMs,
  );
  const body = await response.json().catch(() => null) as T | ApiErrorBody | null;
  if (!response.ok) {
    const errorBody = body as ApiErrorBody | null;
    const error = errorBody?.error;
    const message = typeof error === 'string' ? error : error?.message;
    const code = typeof error === 'string' ? 'mobile_api_error' : error?.code;
    throw new MobileApiError(message ?? 'The request could not be completed.', response.status, code);
  }
  return body as T;
}

export const mobileApi = {
  bootstrap: () => requestJson<PortalBundle>('/api/mobile/bootstrap'),
  cancelAppointment: (appointmentId: string, idempotencyKey: string) =>
    requestJson<{ appointmentId: string; status: 'cancelled' }>(
      `/api/mobile/appointments/${encodeURIComponent(appointmentId)}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
        body: JSON.stringify({ action: 'cancel' }),
      },
    ),
  rescheduleAppointment: (appointmentId: string, startsAt: string, idempotencyKey: string) =>
    requestJson<{ appointment: { id: string; starts_at: string; ends_at: string; status: string } }>(
      `/api/mobile/appointments/${encodeURIComponent(appointmentId)}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
        body: JSON.stringify({ action: 'reschedule', startsAt }),
      },
    ),
  reviewAppointment: (
    appointmentId: string,
    rating: number,
    note: string,
    idempotencyKey: string,
  ) => requestJson<{ review: { id: string; rating: number; note: string } }>(
    `/api/mobile/appointments/${encodeURIComponent(appointmentId)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify({ rating, note }),
    },
  ),
  updateProfile: (
    payload: Pick<PortalProfile, 'fullName' | 'phone' | 'birthday'>,
    idempotencyKey: string,
  ) => requestJson<{ profile: PortalProfile }>(
    '/api/mobile/profile',
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify(payload),
    },
  ),
  uploadProfileAvatar: (photo: Blob, mimeType: string, idempotencyKey: string) =>
    requestJson<{ profile: PortalProfile }>(
      '/api/portal/profile/avatar',
      {
        method: 'POST',
        headers: { 'Content-Type': mimeType, 'Idempotency-Key': idempotencyKey },
        body: photo,
      },
      true,
      45_000,
    ),
  updateIntake: (
    payload: Pick<IntakeProfile, 'concerns' | 'pressurePreference' | 'consentAccepted'>,
    idempotencyKey: string,
  ) => requestJson<{ intake: IntakeProfile }>(
    '/api/mobile/intake',
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify(payload),
    },
  ),
  submitIntake: (
    payload: Pick<IntakeProfile, 'concerns' | 'pressurePreference' | 'consentAccepted'>,
    idempotencyKey: string,
  ) => requestJson<{ intake: IntakeProfile }>(
    '/api/mobile/intake',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify(payload),
    },
  ),
  sendMessage: (body: string, idempotencyKey: string) => requestJson<{ message: PortalMessage }>(
    '/api/mobile/messages',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify({ body }),
    },
  ),
  bookingCatalog: () => requestJson<BookingCatalog>('/api/mobile/booking/catalog', {}, false),
  availability: (serviceSlug: string, date: string, addOnSlugs: string[] = []) => {
    const params = new URLSearchParams({ service: serviceSlug, date, addons: addOnSlugs.join(',') });
    return requestJson<{ slots: string[]; depositCents: number; subtotalCents: number }>(
      `/api/booking/availability?${params.toString()}`,
      {},
      false,
    );
  },
  nextSlot: (serviceSlug: string, addOnSlugs: string[] = [], lookaheadDays = 14) => {
    const params = new URLSearchParams({
      service: serviceSlug,
      addons: addOnSlugs.join(','),
      lookahead: String(lookaheadDays),
    });
    return requestJson<{
      nextSlot: string | null;
      checkedThroughDate: string;
      checkedDays: number;
      date: string;
      tz: string;
      service: string;
      durationMin: number;
      subtotalCents: number;
      depositCents: number;
      slots: string[];
      source: "database" | "demo";
    }>(`/api/booking/next-slot?${params.toString()}`, {}, false);
  },
  createBookingPayment: (payload: {
    serviceSlug: string;
    addonSlugs: string[];
    slot: string;
    fulfillment?: BookingFulfillment;
    idempotencyKey: string;
  }) => requestJson<
    | { paymentRequired: false; appointmentId: string }
    | {
      paymentRequired: true;
      paymentIntent: string;
      ephemeralKey: string;
      customer: string;
      appointmentId: string;
    }
  >(
    '/api/mobile/booking/payment-sheet',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': payload.idempotencyKey },
      body: JSON.stringify(payload),
    },
  ),
  redeemReward: (rewardId: string, idempotencyKey: string) => requestJson<{ availablePoints: number; cashCents: number }>(
    '/api/mobile/rewards/redeem',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify({ rewardId }),
    },
  ),
  completeRewardActivity: (activityKey: string) => requestJson<{ availablePoints: number; annualPoints: number }>(
    '/api/mobile/rewards/activity',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ activityKey }),
    },
  ),
  rewardReferral: () => requestJson<{
    code: string;
    shareUrl: string;
    referrals: RewardReferral[];
  }>(
    '/api/mobile/rewards/referral',
    { method: 'POST' },
  ),
  createGiftPayment: (payload: {
    amountCents: number;
    recipientEmail: string;
    recipientName: string;
    message: string;
    designKey: string;
    deliveryAt: string | null;
    idempotencyKey: string;
  }) => requestJson<{ paymentIntent: string; ephemeralKey: string; customer: string }>(
    '/api/mobile/gifts/payment-sheet',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': payload.idempotencyKey },
      body: JSON.stringify(payload),
    },
  ),
  // Public read: these documents are already published for clients at
  // /intake-forms, so there is nothing here a session would protect.
  intakeForms: () =>
    requestJson<{ forms: IntakeFormCatalogEntry[] }>('/api/portal/intake-forms', {}, false),
  updateIntakeForms: (forms: readonly IntakeFormCatalogEntry[]) =>
    requestJson<{ forms: IntakeFormCatalogEntry[] }>(
      '/api/portal/intake-forms',
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ forms }),
      },
    ),
  staffDashboard: () => requestJson<StaffDashboard>('/api/mobile/staff/dashboard'),
  staffSettings: () => requestJson<{ settings: StaffSettings }>('/api/mobile/staff/settings'),
  updateStaffSettings: (settings: StaffSettings, idempotencyKey: string) =>
    requestJson<{ settings: StaffSettings }>(
      '/api/mobile/staff/settings',
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
        body: JSON.stringify(settings),
      },
    ),
  staffAction: (payload: StaffActionPayload) =>
    requestJson<{ ok: true; targetId: string }>(
      '/api/mobile/staff/action',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': payload.idempotencyKey },
        body: JSON.stringify(Object.fromEntries(
          Object.entries(payload).filter(([key]) => key !== 'idempotencyKey'),
        )),
      },
    ),
  createStaffCheckout: (payload: { appointmentId: string; tipCents: number; idempotencyKey: string }) =>
    requestJson<{ paymentIntent: string; ephemeralKey: string; customer: string }>(
      '/api/mobile/staff/checkout/payment-sheet',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': payload.idempotencyKey },
        body: JSON.stringify(payload),
      },
    ),
  claimGift: (token: string, idempotencyKey: string) => requestJson<{ code: string; balanceCents: number; status: string }>(
    '/api/mobile/gifts/claim',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify({ token, idempotencyKey }),
    },
  ),
};
