import type { BrandRole } from '@platform/schema';

import { hasRole } from '@/lib/auth';
import type { SessionInfo } from '@/lib/demo-data';

/** Owner or platform_admin may tap Go live. Never automatic. */
export function canTapGoLive(session: SessionInfo | null): boolean {
  return hasRole(session, 'brand_owner');
}

export function goLiveRoleLabel(role: BrandRole | undefined): string {
  if (role === 'platform_admin') return 'platform_admin';
  if (role === 'brand_owner') return 'owner';
  return 'unauthorized';
}
