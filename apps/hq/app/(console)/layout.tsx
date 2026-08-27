import type { CSSProperties, ReactNode } from 'react';
import { headers } from 'next/headers';
import Link from 'next/link';

import { currentSession, hasRole } from '@/lib/auth';
import { isConfigured } from '@/lib/supabase-server';
import { NavLink } from '@/components/nav-link';
import { Icon, type IconName } from '@/components/icon';
import { serverClient } from '@/lib/supabase-server';
import { hqTheme } from '@/lib/theme';

import { signOut } from './login/actions';

const pageTitles: Record<string, string> = {
  '/': 'Overview',
  '/locations': 'Locations',
  '/menu': 'Menu',
  '/content': 'Menu',
  '/fees': 'Platform fees',
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

type SectionNavItem = { href: string; label: string; icon: IconName };
type ConsoleSection = {
  key: string;
  title: string;
  icon: SectionNavItem['icon'];
  description: string;
  items: SectionNavItem[];
  home: string;
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
  const menuHref = hasRole(session, 'brand_owner') ? '/content' : '/menu';
  const canManageTraining = hasRole(session, 'location_manager');
  const canManagePlatform = hasRole(session, 'platform_admin');
  const canManageBrand = hasRole(session, 'brand_owner');
  const canAccessGrowth = hasRole(session, 'location_manager') || canManagePlatform || canManageBrand;
  const consoleSections: ConsoleSection[] = [
    {
      key: 'workspace',
      title: 'Workspace',
      icon: 'dashboard',
      home: '/',
      description: 'Core operations, staff locations, and operator content.',
      items: [
        { href: '/', label: 'Overview', icon: 'dashboard' },
        { href: '/locations', label: 'Locations', icon: 'locations' },
        { href: menuHref, label: 'Menu', icon: 'menu' },
        ...(canManageTraining ? [{ href: '/training', label: 'Training', icon: 'training' as const }] : []),
      ],
    },
    {
      key: 'growth',
      title: 'Growth',
      icon: 'drop',
      home: '/drops',
      description: 'Campaigns, promotions, and customer growth programs.',
      items: canAccessGrowth
        ? [
            { href: '/drops', label: 'Drops', icon: 'drop' },
            { href: '/campaigns', label: 'Campaigns', icon: 'brand' },
            { href: '/customers', label: 'Customers', icon: 'users' },
          ]
        : [],
    },
    {
      key: 'insights',
      title: 'Insights',
      icon: 'analytics',
      home: '/analytics',
      description: 'Store operations and business reporting.',
      items: hasRole(session, 'location_manager') ? [{ href: '/analytics', label: 'Analytics', icon: 'analytics' }] : [],
    },
    {
      key: 'platform',
      title: 'Platform',
      icon: 'settings',
      home: '/brand',
      description: 'Configuration, onboarding, and operational tooling.',
      items: [
        ...(canManagePlatform ? [{ href: '/fees', label: 'Platform fees', icon: 'settings' as const }] : []),
        ...(canManageBrand ? [{ href: '/brand', label: 'Brand config', icon: 'brand' }] : []),
        ...(canManageBrand ? [{ href: '/kiosk', label: 'Kiosk', icon: 'kiosk' }] : []),
        ...(canManagePlatform ? [{ href: '/onboarding', label: 'Onboarding', icon: 'onboarding' }] : []),
      ],
    },
    {
      key: 'preview',
      title: 'Preview',
      icon: 'wall',
      home: '/wall',
      description: 'Live wall and floor-side console view.',
      items: [{ href: '/wall', label: 'Live wall', icon: 'wall' }],
    },
  ].filter((section) => section.items.length > 0);

  const activeSection =
    consoleSections.find((section) =>
      section.items.some((item) =>
        pathname === item.href || (item.href === '/' ? pathname === '/' : pathname.startsWith(`${item.href}/`)),
      ),
    ) ?? consoleSections.find((section) => section.items.some((item) => item.href === pathname)) ?? consoleSections[0];
  const activeSectionLabel = activeSection?.title ?? 'Workspace';
  const contextTitle = pageTitle === 'Workspace' ? `${activeSectionLabel}` : pageTitle;
  return (
    <div className="shell" style={hqTheme(brandConfig) as CSSProperties}>
      <a className="skip-link" href="#main-content">Skip to content</a>
      <aside className="primary-rail" aria-label="Primary navigation">
        <Link href="/" className="brand-mark" aria-label={`${brandName} home`}>
          <span>{initials.charAt(0)}</span>
        </Link>
        <div className="primary-rail-nav">
          {consoleSections.map((section) => (
            <NavLink key={section.key} href={section.home} icon={section.icon} className="primary-link" ariaLabel={`${section.title} section`}>
              {section.title}
            </NavLink>
          ))}
        </div>
        <div className="primary-rail-footer">
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
          <p className="nav-section-label">Current section</p>
          <div className="section-card">
            <strong>{activeSectionLabel}</strong>
            <small>{activeSection?.description}</small>
          </div>

          <p className="nav-section-label">Tabs</p>
          <div className="section-tabs">
            {activeSection.items.map((item) => (
              <NavLink key={item.href} href={item.href} icon={item.icon} className="secondary-rail-link">
                {item.label}
              </NavLink>
            ))}
          </div>
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
            <strong>{contextTitle}</strong>
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
