export type EnrollmentDecision = 'accept' | 'reject';

export type EnrollmentResponseInput = {
  readonly brandId: string;
  readonly networkId: string;
  readonly decision: EnrollmentDecision;
};

export type EnrollmentResponseOutcome = 'accepted' | 'rejected' | 'stale' | 'failed';

type RpcError = { readonly code?: string } | null;
type RpcResult = { readonly data: unknown; readonly error: RpcError };
type EnrollmentRpc = (args: {
  readonly p_accept: boolean;
  readonly p_brand_id: string;
  readonly p_network_id: string;
}) => PromiseLike<RpcResult>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function enrollmentResponseInput(formData: FormData): EnrollmentResponseInput | null {
  const brandId = formData.get('brandId');
  const networkId = formData.get('networkId');
  const decision = formData.get('decision');
  if (
    typeof brandId !== 'string'
    || typeof networkId !== 'string'
    || !UUID.test(brandId)
    || !UUID.test(networkId)
    || (decision !== 'accept' && decision !== 'reject')
  ) return null;
  return { brandId, networkId, decision };
}

export async function submitEnrollmentResponse(
  rpc: EnrollmentRpc,
  input: EnrollmentResponseInput,
): Promise<EnrollmentResponseOutcome> {
  const result = await rpc({
    p_accept: input.decision === 'accept',
    p_brand_id: input.brandId,
    p_network_id: input.networkId,
  });
  if (result.error?.code === '23503') return 'stale';
  if (result.error) return 'failed';
  if (input.decision === 'accept' && result.data === 'active') return 'accepted';
  if (input.decision === 'reject' && result.data === 'rejected') return 'rejected';
  return 'failed';
}

export type FranchiseConsentReadiness = {
  readonly required: boolean;
  readonly ready: boolean;
  readonly status: 'not-required' | 'pending' | 'failed' | 'passed';
  readonly evidence: string;
};

export type NetworkStatus = {
  readonly networkId: string;
  readonly status: string;
};

const FAILED_STATUSES = new Set(['rejected', 'revoked', 'suspended', 'terminated']);

export function franchiseConsentReadiness(
  organizationKind: string,
  memberships: readonly NetworkStatus[],
  agreements: readonly NetworkStatus[],
): FranchiseConsentReadiness {
  if (organizationKind !== 'franchisee') {
    return { required: false, ready: true, status: 'not-required', evidence: 'Not required' };
  }
  const agreementByNetwork = new Map(agreements.map((row) => [row.networkId, row.status]));
  const ready = memberships.some((membership) =>
    membership.status === 'active' && agreementByNetwork.get(membership.networkId) === 'active');
  const statuses = [...memberships, ...agreements].map((row) => row.status);
  const failed = statuses.length > 0 && statuses.every((status) => FAILED_STATUSES.has(status));
  const statusList = (rows: readonly NetworkStatus[]) =>
    [...new Set(rows.map((row) => row.status))].sort().join(', ') || 'missing';
  return {
    required: true,
    ready,
    status: ready ? 'passed' : failed ? 'failed' : 'pending',
    evidence: `Membership: ${statusList(memberships)} · Agreement: ${statusList(agreements)}`,
  };
}

export function agreementTerms(value: unknown, emptyLabel: string): string {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return emptyLabel;
  if (Object.keys(value).length === 0) return emptyLabel;
  return JSON.stringify(value, null, 2);
}
