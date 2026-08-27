/**
 * The console's gate. On a configured deployment every page needs a
 * signed-in user; the platform API routes authenticate their own bearer
 * tokens, the Square webhook verifies its signature, and the public status
 * page stays public. Unconfigured deployments (previews, local demo work)
 * pass straight through and render on the demo session.
 *
 * This is also where the auth cookie refreshes: server components render
 * read-only, so getUser() here keeps the session alive for them.
 */
import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

import { previewWallRuntimeEnabled } from './lib/demo-sync-http';

const PUBLIC_PREFIXES = ['/login', '/api/', '/status/'];

export async function middleware(request: NextRequest) {
  if (previewWallRuntimeEnabled()) return NextResponse.next();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return NextResponse.next();

  const { pathname } = request.nextUrl;
  // The console layout also runs for /login and the public status page. Carry
  // the path on the internal request so layout-level tenant gating can skip
  // those public surfaces without trusting a client-supplied header.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-hq-pathname', pathname);
  let response = NextResponse.next({ request: { headers: requestHeaders } });
  const client = createServerClient(url, anonKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (updates) => {
        for (const { name, value } of updates) request.cookies.set(name, value);
        response = NextResponse.next({ request: { headers: requestHeaders } });
        for (const { name, value, options } of updates) response.cookies.set(name, value, options);
      },
    },
  });

  const { data } = await client.auth.getUser();
  const isPublic = PUBLIC_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(prefix));
  if (!data.user && !isPublic) {
    const login = request.nextUrl.clone();
    login.pathname = '/login';
    login.search = '';
    return NextResponse.redirect(login);
  }
  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|ico|css|js)$).*)'],
};
