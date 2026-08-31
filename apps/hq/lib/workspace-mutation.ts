import { randomUUID } from 'node:crypto';

import type { SessionInfo } from './demo-data';
import { recordPlatformAccess } from './platform-access-audit';
export { claimsForWorkspaceMutation } from './workspace-mutation-claims';
import { authorizeLocation, selectedOrganizationId } from './workspace-scope';
import { requiresWorkspaceServiceRole } from './workspace-service-role';

export type WorkspaceMutation = {
  auditCorrelationId: string | null;
  brandId: string;
  locationId: string | null;
  serviceRole: boolean;
};

type MutationOptions = {
  action: string;
  auditHome?: boolean;
  locationId?: string | null;
};

/** Resolves and audits the selected tenant immediately before a mutation. */
export async function authorizeWorkspaceMutation(
  session: SessionInfo,
  options: MutationOptions,
): Promise<WorkspaceMutation | null> {
  const brandId = await selectedOrganizationId(session);
  const locationId = options.locationId ?? null;
  if (locationId && !await authorizeLocation(session, brandId, locationId)) return null;

  const serviceRole = requiresWorkspaceServiceRole(session, brandId);
  if (!serviceRole && !options.auditHome) {
    return { auditCorrelationId: null, brandId, locationId, serviceRole };
  }
  if (session.role !== 'platform_admin' || !session.userId) return null;

  const auditCorrelationId = randomUUID();
  const audited = await recordPlatformAccess(session, {
    action: options.action,
    brandId,
    correlationId: auditCorrelationId,
    locationId,
    required: serviceRole || options.auditHome,
  });
  return audited ? { auditCorrelationId, brandId, locationId, serviceRole } : null;
}
