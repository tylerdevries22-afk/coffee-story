/**
 * Session + role gating. With SUPABASE env present this reads the signed-in
 * user's tenancy claims (@platform/schema parses them); without it the
 * console runs on the demo session so the whole surface is reviewable with
 * zero infrastructure. Role checks are the same code either way.
 */
import { parseTenantClaims, type BrandRole } from '@platform/schema';

import { DEMO_SESSION, type SessionInfo } from './demo-data';
import { previewWallRuntimeEnabled } from './demo-sync-http';
import { brandNameFromMetadata, tokenAppMetadata } from './token-claims';

export function isConfigured(): boolean {
  return !previewWallRuntimeEnabled()
    && Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}

/** Server-side: the current session, or the demo one when unconfigured. */
export async function currentSession(): Promise<SessionInfo | null> {
  if (!isConfigured()) return DEMO_SESSION;
  // Reuse the request-bound client so authentication and page reads share the
  // same cookie handling, ten-second deadline, and bounded safe-read retry.
  const { serverClient } = await import('./supabase-server');
  const client = await serverClient();
  if (!client) return null;
  // getUser verifies the token with GoTrue; the claims themselves have to come
  // out of the token's own payload. The hook mints them into the token it
  // issues and never onto the user row, so reading `data.user.app_metadata`
  // returned nothing every time -- and `hasRole` then answered false for
  // every role, hiding the platform operator's own pages from them.
  const { data } = await client.auth.getUser();
  if (!data.user) return null;
  const { data: sessionData } = await client.auth.getSession();
  const accessToken = sessionData.session?.access_token;
  if (!accessToken) return null;
  const metadata = tokenAppMetadata(accessToken);
  const claims = parseTenantClaims(metadata);
  if (!claims?.role) return null;
  return {
    email: data.user.email ?? '',
    role: claims.role,
    brandId: claims.brand_id,
    brandName: brandNameFromMetadata(metadata) ?? 'Your brand',
  };
}

const ROLE_RANK: Record<BrandRole, number> = {
  staff: 0,
  location_manager: 1,
  brand_owner: 2,
  platform_admin: 3,
};

export function hasRole(session: SessionInfo | null, atLeast: BrandRole): boolean {
  if (!session) return false;
  return ROLE_RANK[session.role] >= ROLE_RANK[atLeast];
}
