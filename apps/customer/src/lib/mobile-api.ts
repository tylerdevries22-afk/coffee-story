/**
 * The live-mode write seam the screens call. Everything here rides the
 * platform API (@platform/api-client → the HQ deployment) with the guest's
 * own access token; the legacy orders host is gone.
 *
 * Methods whose domain the live schema does not serve yet throw a 501
 * MobileApiError instead of pretending — their entry points are hidden in
 * live mode (the bundle omits the domain), so a guest only ever sees this
 * error if they reach a demo-only surface some other way.
 */
import { ApiError, type ApiClient } from '@platform/api-client';

import { platformApi } from '@/lib/api';
import { TENANT } from '@/tenant';
import type { PortalProfile, RewardReferral } from '@/types/domain';

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

function requireApi(): ApiClient {
  if (!platformApi) {
    throw new MobileApiError('Live ordering is not configured in this build.', 503, 'configuration_missing');
  }
  return platformApi;
}

function rethrow(error: unknown): never {
  if (error instanceof ApiError) throw new MobileApiError(error.message, error.status, error.code);
  if (error instanceof Error) throw new MobileApiError(error.message, 503, 'network');
  throw error;
}

function notAvailable(what: string): never {
  throw new MobileApiError(`${what} is coming to live accounts soon. It works fully in Demo.`, 501, 'not_available');
}

export const mobileApi = {
  updateProfile: async (
    payload: Pick<PortalProfile, 'fullName' | 'phone' | 'birthday'>,
    _idempotencyKey: string,
  ): Promise<void> => {
    // Birthday has no live column yet; the supported fields write through.
    try {
      await requireApi().updateProfile({ fullName: payload.fullName, phone: payload.phone });
    } catch (error) {
      rethrow(error);
    }
  },
  redeemReward: async (rewardSlug: string, idempotencyKey: string): Promise<{ pointsBalance: number }> => {
    try {
      return await requireApi().redeemReward({ rewardSlug }, idempotencyKey);
    } catch (error) {
      rethrow(error);
    }
  },
  rewardReferral: async (): Promise<{ code: string; shareUrl: string; referrals: RewardReferral[] }> => {
    try {
      const minted = await requireApi().mintReferral();
      return {
        code: minted.code,
        shareUrl: `${TENANT.business.website}/refer/${minted.code}`,
        referrals: [],
      };
    } catch (error) {
      rethrow(error);
    }
  },

  // ---- Domains the live schema does not serve yet ----
  // Typed to their legacy shapes so demo-era call sites keep compiling; the
  // implementations only ever throw.
  completeRewardActivity: async (_activityKey: string): Promise<{ availablePoints: number; annualPoints: number }> =>
    notAvailable('Earning activities'),
  cancelAppointment: async (_id: string, _key: string): Promise<{ status: 'cancelled' }> =>
    notAvailable('Cancelling an order'),
  rescheduleAppointment: async (_id: string, _startsAt: string, _key: string): Promise<{ placedAt: string }> =>
    notAvailable('Rescheduling'),
  reviewAppointment: async (_id: string, _rating: number, _note: string, _key: string): Promise<{ ok: true }> =>
    notAvailable('Reviews'),
  uploadProfileAvatar: async (_photo: Blob, _mimeType: string, _key: string): Promise<{ profile: PortalProfile }> =>
    notAvailable('Profile photos'),
  updateIntake: async (_payload: unknown, _key: string): Promise<{ ok: true }> => notAvailable('Preferences'),
  submitIntake: async (_payload: unknown, _key: string): Promise<{ ok: true }> => notAvailable('Preferences'),
  sendMessage: async (_body: string, _key: string): Promise<{ ok: true }> => notAvailable('Messages'),
  createGiftPayment: async (_payload: unknown): Promise<{ paymentIntent: string }> => notAvailable('Gift cards'),
  claimGift: async (_token: string, _key: string): Promise<{ code: string; balanceCents: number; status: string }> =>
    notAvailable('Gift cards'),
};
