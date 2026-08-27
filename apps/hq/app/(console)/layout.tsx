import type { CSSProperties, ReactNode } from 'react';
import { headers } from 'next/headers';

import { currentSession, hasRole } from '@/lib/auth';
import { isConfigured } from '@/lib/supabase-server';
import { NavLink } from '@/components/nav-link';
import { serverClient } from '@/lib/supabase-server';
import { hqTheme } from '@/lib/theme';

import { signOut } from './login/actions';

/**
 * The console shell: sidebar, session, role-gated nav.
 *
 * A route group rather than the root layout, because not everything this app
 * serves is the console. The pickup display is a storefront screen that
 * happens to be served from here and must not inherit a nav a guest can see.
 */
export default async function ConsoleLayout({ children }: { children: ReactNode }) {
  const [session, client] = await Promise.all([currentSession(), serverClient()]);
  const pathname = (await headers()).get('x-hq-pathname') ?? '';
  const isPublicConsolePath = pathname === '/login' || pathname.startsWith('/status/');
  if (isConfigured() && !session && !isPublicConsolePath) {
    const user = client ? await client.auth.getUser() : null;
    return (
      <div className="shell">
        <main className="main">
          <section className="card access-card">
            <h1>Tenant access required</h1>
            <p className="subtitle">
              {user?.data.user?.email
                ? `You are signed in as ${user.data.user.email}, but this account is not assigned to a tenant. Ask a Coffee Story owner to add your staff role, then sign in again.`
                : 'Your session is not assigned to a tenant. Sign in again or ask a Coffee Story owner to add your staff role.'}
            </p>
            <form action={signOut}>
              <button type="submit" className="button">Sign out</button>
            </form>
          </section>
        </main>
      </div>
    );
  }
  // The tenant-safe wall preview is embedded by the /wall console page. It
  // lives in this route group so it can reuse the session-bound data layer,
  // but must not inherit the sidebar or console chrome inside the iframe.
  if (pathname.startsWith('/wall/preview/')) return children;
  const brand = client && session
    ? await client.from('brands').select('brand_config').eq('id', session.brandId).maybeSingle<{ brand_config: unknown }>()
    : null;
  const brandConfig = brand && !brand.error ? brand.data?.brand_config : null;
  return (
    <div className="shell" style={hqTheme(brandConfig) as CSSProperties}>
      <nav className="sidebar" aria-label="Console">
        <div className="brand">{session?.brandName ?? 'HQ'}</div>
        <NavLink href="/">Dashboard</NavLink>
        <NavLink href="/locations">Locations</NavLink>
        <NavLink href={hasRole(session, 'brand_owner') ? '/content' : '/menu'}>Menu</NavLink>
        {hasRole(session, 'location_manager') ? <NavLink href="/training">Training</NavLink> : null}
        <NavLink href="/drops">Drops</NavLink>
        <NavLink href="/campaigns">Campaigns</NavLink>
        <NavLink href="/customers">Customers</NavLink>
        <NavLink href="/analytics">Analytics</NavLink>
        {hasRole(session, 'platform_admin') ? <NavLink href="/fees">Platform fees</NavLink> : null}
        {hasRole(session, 'brand_owner') ? <NavLink href="/brand">Brand config</NavLink> : null}
        {hasRole(session, 'brand_owner') ? <NavLink href="/kiosk">Kiosk</NavLink> : null}
        {hasRole(session, 'platform_admin') ? <NavLink href="/onboarding">Onboarding</NavLink> : null}
        <NavLink href="/wall" className="wall-nav">Wall</NavLink>
        <div className="session">
          {session ? (
            <>
              {session.email}
              <br />
              {session.role.replace('_', ' ')}
              {isConfigured() ? (
                <form action={signOut}>
                  <button type="submit" className="linklike">Sign out</button>
                </form>
              ) : null}
            </>
          ) : 'Signed out'}
        </div>
      </nav>
      <main className="main">{children}</main>
    </div>
  );
}
