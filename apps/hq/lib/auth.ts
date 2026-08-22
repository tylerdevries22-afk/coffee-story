/**
 * Session + role gating. With SUPABASE env present this reads the signed-in
 * user's tenancy claims (@platform/schema parses them); without it the
 * console runs on the demo session so the whole surface is reviewable with
 * zero infrastructure. Role checks are the same code either way.
 */
import { parseTenantClaims, type BrandRole } from '@platform/schema';

import { DEMO_SESSION, type SessionInfo } from './demo-data';

export function isConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}

/** Server-side: the current session, or the demo one when unconfigured. */
export async function currentSession(): Promise<SessionInfo | null> {
  if (!isConfigured()) return DEMO_SESSION;
  // Cookie-based Supabase SSR wiring lands with real deployments; the shape
  // it must produce is exactly SessionInfo, via parseTenantClaims.
  const { createServerClient } = await import('@supabase/ssr');
  const { cookies } = await import('next/headers');
  const store = await cookies();
  const client = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => store.getAll(),
        setAll: () => { /* read-only in server components */ },
      },
    },
  );
  const { data } = await client.auth.getUser();
  if (!data.user) return null;
  const claims = parseTenantClaims(data.user.app_metadata);
  if (!claims?.role) return null;
  return {
    email: data.user.email ?? '',
    role: claims.role,
    brandName: (data.user.app_metadata as { brand_name?: string }).brand_name ?? 'Your brand',
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
