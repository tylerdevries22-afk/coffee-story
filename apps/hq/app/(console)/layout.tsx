import type { CSSProperties, ReactNode } from 'react';
import { headers } from 'next/headers';
import Link from 'next/link';

import { currentSession, hasRole } from '@/lib/auth';
import { isConfigured } from '@/lib/supabase-server';
import { NavLink } from '@/components/nav-link';
import { Icon } from '@/components/icon';
import { serverClient } from '@/lib/supabase-server';
import { hqTheme } from '@/lib/theme';

import { signOut } from './login/actions';

const pageTitles: Record<string, string> = {
  '/': 'Overview',
  '/locations': 'Locations',
  '/menu': 'Menu',
  '/content': 'Menu',
  '/training': 'Training',
  '/drops': 'Drops',
  '/campaigns': 'Campaigns',
  '/customers': 'Customers',
  '/analytics': 'Analytics',
  '/fees': 'Platform fees',
  '/brand': 'Brand config',
  '/kiosk': 'Kiosk',
  '/onboarding': 'Onboarding',
  '/wall': 'Live wall',
};

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
  const brandName = session?.brandName ?? 'Coffee Story';
  const initials = brandName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word.charAt(0))
    .join('')
    .toUpperCase() || 'HQ';
  const statusSlug = brandName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 64) || 'tenant';
  const pageTitle = pageTitles[pathname] ?? (pathname.startsWith('/wall') ? 'Live wall' : 'Workspace');
  const canManageTraining = hasRole(session, 'location_manager');
  return (
    <div className="shell" style={hqTheme(brandConfig) as CSSProperties}>
      <a className="skip-link" href="#main-content">Skip to content</a>
      <aside className="primary-rail" aria-label="Primary navigation">
        <Link href="/" className="brand-mark" aria-label={`${brandName} home`}>
          <span>{initials.charAt(0)}</span>
        </Link>
        <div className="primary-rail-nav">
          <NavLink href="/" icon="dashboard" ariaLabel="Overview">Overview</NavLink>
          <NavLink href="/locations" icon="locations" ariaLabel="Locations">Locations</NavLink>
          <NavLink href={hasRole(session, 'brand_owner') ? '/content' : '/menu'} icon="menu" ariaLabel="Menu">Menu</NavLink>
          {canManageTraining ? <NavLink href="/training" icon="training" ariaLabel="Training">Training</NavLink> : null}
          <NavLink href="/analytics" icon="analytics" ariaLabel="Analytics">Analytics</NavLink>
        </div>
        <div className="primary-rail-footer">
          <NavLink href="/wall" icon="wall" ariaLabel="Live wall">Wall</NavLink>
          <Link href={`/status/${statusSlug}`} className="primary-link" aria-label="System status" title="System status">
            <span className="nav-link-icon"><Icon name="activity" size={17} /></span>
            <span className="nav-link-label">System status</span>
          </Link>
        </div>
      </aside>
      <aside className="sidebar secondary-rail" aria-label="Console navigation">
        <div className="sidebar-header">
          <div className="brand-lockup">
            <span className="brand-glyph">{initials.charAt(0)}</span>
            <span><strong>{brandName}</strong><small>HQ console</small></span>
          </div>
          <span className="sidebar-menu-dot" aria-hidden="true">•••</span>
        </div>
        <div className="workspace-switcher" aria-label="Current workspace">
          <span className="workspace-avatar">{initials}</span>
          <span className="workspace-switcher-copy"><small>Workspace</small><strong>{brandName}</strong></span>
          <Icon name="chevron" size={16} />
        </div>
        <div className="sidebar-scroll">
          <p className="nav-section-label">Workspace</p>
          <NavLink href="/" icon="dashboard">Overview</NavLink>
          <NavLink href="/locations" icon="locations">Locations</NavLink>
          <NavLink href={hasRole(session, 'brand_owner') ? '/content' : '/menu'} icon="menu">Menu</NavLink>
          {canManageTraining ? <NavLink href="/training" icon="training">Training</NavLink> : null}

          <p className="nav-section-label">Growth</p>
          <NavLink href="/drops" icon="drop">Drops</NavLink>
          <NavLink href="/campaigns" icon="brand">Campaigns</NavLink>
          <NavLink href="/customers" icon="users">Customers</NavLink>

          <p className="nav-section-label">Insights</p>
          <NavLink href="/analytics" icon="analytics">Analytics</NavLink>

          <p className="nav-section-label">Platform</p>
          {hasRole(session, 'platform_admin') ? <NavLink href="/fees" icon="settings">Platform fees</NavLink> : null}
          {hasRole(session, 'brand_owner') ? <NavLink href="/brand" icon="brand">Brand config</NavLink> : null}
          {hasRole(session, 'brand_owner') ? <NavLink href="/kiosk" icon="kiosk">Kiosk</NavLink> : null}
          {hasRole(session, 'platform_admin') ? <NavLink href="/onboarding" icon="onboarding">Onboarding</NavLink> : null}

          <p className="nav-section-label">Preview</p>
          <NavLink href="/wall" icon="wall" className="wall-nav">Live wall</NavLink>
        </div>
        <div className="session">
          {session ? (
            <div className="session-row">
              <span className="session-avatar">{initials}</span>
              <span className="session-copy"><strong>{session.email}</strong><small>{session.role.replace('_', ' ')}</small></span>
              {isConfigured() ? (
                <form action={signOut}>
                  <button type="submit" className="session-signout" aria-label="Sign out" title="Sign out"><Icon name="external" size={15} /></button>
                </form>
              ) : null}
            </div>
          ) : <span>Signed out</span>}
        </div>
      </aside>
      <div className="app-content">
        <header className="topbar">
          <div className="breadcrumb" aria-label="Current page">
            <span className="breadcrumb-muted">Workspace</span>
            <Icon name="chevron" size={15} />
            <strong>{pageTitle}</strong>
          </div>
          <div className="topbar-actions">
            <span className="sync-state"><span className="sync-dot" /> Supabase synced</span>
            <Link className="topbar-wall" href="/wall"><Icon name="wall" size={16} /> Live wall</Link>
            <span className="topbar-avatar" aria-hidden="true">{initials}</span>
          </div>
        </header>
        <main id="main-content" className="main">{children}</main>
      </div>
    </div>
  );
}
