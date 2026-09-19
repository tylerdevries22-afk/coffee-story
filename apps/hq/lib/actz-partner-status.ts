/** Read-only ACTZ partner org status. Never triggers go-live. */
export type ActzPartnerLifecycleStatus = 'sandbox' | 'awaiting_go_live' | 'live';

export type ActzPartnerStatusInput = {
  readonly brandId: string;
  readonly slug: string;
  readonly name: string;
  readonly actzProviderOrgId: string | null;
  readonly brandStatus: string;
  readonly runStage: string | null;
};

export type ActzPartnerStatusBody = {
  readonly brandId: string;
  readonly slug: string;
  readonly name: string;
  readonly actzProviderOrgId: string | null;
  readonly status: ActzPartnerLifecycleStatus;
  readonly brandStatus: string;
  readonly runStage: string | null;
};

/**
 * Map brand + provisioning run → partner lifecycle.
 * `live` only when run stage is `active`. Partner APIs never mutate go-live.
 */
export function actzPartnerStatusFrom(input: ActzPartnerStatusInput): ActzPartnerStatusBody {
  let status: ActzPartnerLifecycleStatus = 'sandbox';
  if (input.runStage === 'active') status = 'live';
  else if (input.runStage === 'ready' || input.runStage === 'awaiting_external') {
    status = 'awaiting_go_live';
  }
  return {
    brandId: input.brandId,
    slug: input.slug,
    name: input.name,
    actzProviderOrgId: input.actzProviderOrgId,
    status,
    brandStatus: input.brandStatus,
    runStage: input.runStage,
  };
}
