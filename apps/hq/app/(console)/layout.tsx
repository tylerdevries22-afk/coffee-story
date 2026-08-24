import type { ReactNode } from 'react';

import { currentSession, hasRole } from '@/lib/auth';
import { isConfigured } from '@/lib/supabase-server';
import { NavLink } from '@/components/nav-link';

import { signOut } from './login/actions';

/**
 * The console shell: sidebar, session, role-gated nav.
 *
 * A route group rather than the root layout, because not everything this app
 * serves is the console. The pickup display is a storefront screen that
 * happens to be served from here and must not inherit a nav a guest can see.
 */
export default async function ConsoleLayout({ children }: { children: ReactNode }) {
  const session = await currentSession();
  return (
    <div className="shell">
      <nav className="sidebar" aria-label="Console">
        <div className="brand">{session?.brandName ?? 'HQ'}</div>
        <NavLink href="/">Dashboard</NavLink>
        <NavLink href="/locations">Locations</NavLink>
        <NavLink href="/menu">Menu</NavLink>
        <NavLink href="/drops">Drops</NavLink>
        <NavLink href="/campaigns">Campaigns</NavLink>
        <NavLink href="/customers">Customers</NavLink>
        <NavLink href="/analytics">Analytics</NavLink>
        {hasRole(session, 'platform_admin') ? <NavLink href="/fees">Platform fees</NavLink> : null}
        {hasRole(session, 'brand_owner') ? <NavLink href="/brand">Brand config</NavLink> : null}
        {hasRole(session, 'brand_owner') ? <NavLink href="/kiosk">Kiosk</NavLink> : null}
        {hasRole(session, 'platform_admin') ? <NavLink href="/onboarding">Onboarding</NavLink> : null}
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
