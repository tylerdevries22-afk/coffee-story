import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { currentSession, hasRole } from '@/lib/auth';
import { NavLink } from '@/components/nav-link';

import './globals.css';

export const metadata: Metadata = {
  title: 'HQ',
  description: 'Multi-tenant ordering platform console',
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const session = await currentSession();
  return (
    <html lang="en">
      <body>
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
            {hasRole(session, 'platform_admin') ? <NavLink href="/onboarding">Onboarding</NavLink> : null}
            <div className="session">
              {session ? (
                <>
                  {session.email}
                  <br />
                  {session.role.replace('_', ' ')}
                </>
              ) : 'Signed out'}
            </div>
          </nav>
          <main className="main">{children}</main>
        </div>
      </body>
    </html>
  );
}
