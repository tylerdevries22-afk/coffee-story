import type { TenantClaims } from '@platform/schema';

import type { SessionInfo } from './demo-data';
import type { WorkspaceMutation } from './workspace-mutation';

/** Restricts a trusted writer to the already-authorized mutation scope. */
export function claimsForWorkspaceMutation(
  session: SessionInfo,
  mutation: WorkspaceMutation,
): TenantClaims | null {
  if (!session.userId) return null;
  return {
    brand_id: mutation.brandId,
    location_ids: mutation.locationId ? [mutation.locationId] : [],
    role: session.role,
  };
}
