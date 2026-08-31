/**
 * Where the console remembers which organization and location the operator is
 * looking at. Two cookies, read on every navigation and re-authorized against
 * the real set server-side (lib/workspace-scope.ts) -- a forged value never
 * grants scope it did not already have, it only fails the shape check here or
 * the membership check there and falls back to the default.
 */
import type { ResponseCookie } from 'next/dist/compiled/@edge-runtime/cookies';

export const ORG_COOKIE = 'hq_org';
export const LOCATION_COOKIE = 'hq_location';

// A brand UUID (configured) or a tenant/location slug (demo). Anything else is
// not something this app ever wrote, so reject it before it reaches a lookup.
const VALUE_PATTERN = /^[a-z0-9-]{1,64}$/i;

export function isWorkspaceCookieValue(value: string | undefined): value is string {
  return typeof value === 'string' && VALUE_PATTERN.test(value);
}

export function workspaceCookieOptions(): Partial<ResponseCookie> {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
  };
}

/** Expire a workspace cookie with the same scope used when it was created. */
export function expiredWorkspaceCookieOptions(): Partial<ResponseCookie> {
  return {
    ...workspaceCookieOptions(),
    expires: new Date(0),
    maxAge: 0,
  };
}
