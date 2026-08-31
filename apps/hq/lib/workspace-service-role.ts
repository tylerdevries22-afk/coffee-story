import type { SessionInfo } from './demo-data';

/** Platform-admin writes always use the audited service-role path. */
export function requiresWorkspaceServiceRole(session: SessionInfo, brandId: string): boolean {
  return brandId !== session.brandId || session.role === 'platform_admin';
}
