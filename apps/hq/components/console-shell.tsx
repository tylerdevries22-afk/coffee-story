'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { CSSProperties, ReactNode } from 'react';

import {
  consoleSectionForPath,
  type ConsoleSection,
} from '@/lib/console-navigation';

import { Icon } from './icon';
import { NavLink } from './nav-link';

const PAGE_TITLES: Readonly<Record<string, string>> = {
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
  '/brand': 'Brand config',
  '/kiosk': 'Kiosk',
  '/onboarding': 'Onboarding',
  '/wall': 'Live wall',
};

const FALLBACK_SECTION: ConsoleSection = {
  key: 'operations',
  title: 'Operations',
  icon: 'dashboard',
  home: '/',
  items: [],
};

type ConsoleShellProps = {
  readonly children: ReactNode;
  readonly theme: CSSProperties;
  readonly sections: readonly ConsoleSection[];
  readonly brandName: string;
  readonly initials: string;
  readonly statusHref: string;
  readonly sessionFooter: ReactNode;
};

type PrimaryRailProps = Pick<ConsoleShellProps, 'brandName' | 'initials' | 'sections' | 'statusHref'> & {
  readonly activeSectionKey?: string;
};

function PrimaryRail({ brandName, initials, sections, statusHref, activeSectionKey }: PrimaryRailProps) {
  return (
    <aside className="primary-rail" aria-label="Primary navigation">
      <Link href="/" className="brand-mark" aria-label={`${brandName} home`}>
        <span>{initials.charAt(0)}</span>
      </Link>
      <div className="primary-rail-nav">
        {sections.map((section) => (
          <NavLink
            key={section.key}
            href={section.home}
            icon={section.icon}
            className="primary-link"
            ariaLabel={`${section.title} section`}
            active={section.key === activeSectionKey}
          >
            {section.title}
          </NavLink>
        ))}
      </div>
      <div className="primary-rail-footer">
        <NavLink href={statusHref} icon="activity" className="primary-link" ariaLabel="System status">
          System status
        </NavLink>
      </div>
    </aside>
  );
}

type SecondaryRailProps = Pick<ConsoleShellProps, 'brandName' | 'initials' | 'sessionFooter'> & {
  readonly section: ConsoleSection;
};

function SecondaryRail({ brandName, initials, section, sessionFooter }: SecondaryRailProps) {
  return (
    <aside className="sidebar secondary-rail" aria-label="Console navigation">
      <div className="sidebar-header">
        <div className="brand-lockup">
          <span className="brand-glyph">{initials.charAt(0)}</span>
          <span><strong>{brandName}</strong><small>HQ console</small></span>
        </div>
        <span className="sidebar-menu-dot" aria-hidden="true">•••</span>
      </div>
      <div className="sidebar-scroll">
        <p className="nav-section-label">Tabs</p>
        <div className="section-tabs">
          {section.items.map((item) => (
            <NavLink key={item.href} href={item.href} icon={item.icon} className="secondary-rail-link">
              {item.label}
            </NavLink>
          ))}
        </div>
      </div>
      {sessionFooter}
    </aside>
  );
}

function ConsoleTopbar({ section, pageTitle, initials }: { section: ConsoleSection; pageTitle: string; initials: string }) {
  return (
    <header className="topbar">
      <div className="breadcrumb" aria-label="Current page">
        <span className="breadcrumb-muted">{section.title}</span>
        <Icon name="chevron" size={15} />
        <strong>{pageTitle}</strong>
      </div>
      <div className="topbar-actions">
        <span className="sync-state"><span className="sync-dot" /> Supabase synced</span>
        <Link className="topbar-wall" href="/wall"><Icon name="wall" size={16} /> Live wall</Link>
        <span className="topbar-avatar" aria-hidden="true">{initials}</span>
      </div>
    </header>
  );
}

/** Pathname-aware console chrome that keeps both navigation rails synchronized. */
export function ConsoleShell(props: ConsoleShellProps) {
  const pathname = usePathname();
  const matchedSection = consoleSectionForPath(props.sections, pathname);
  const activeSection = matchedSection ?? props.sections[0] ?? FALLBACK_SECTION;
  const routeTitle = PAGE_TITLES[pathname] ?? (pathname.startsWith('/wall') ? 'Live wall' : 'Workspace');
  const pageTitle = routeTitle === 'Workspace' ? activeSection.title : routeTitle;

  return (
    <div className="shell" style={props.theme}>
      <a className="skip-link" href="#main-content">Skip to content</a>
      <PrimaryRail
        brandName={props.brandName}
        initials={props.initials}
        sections={props.sections}
        statusHref={props.statusHref}
        activeSectionKey={matchedSection?.key}
      />
      <SecondaryRail
        brandName={props.brandName}
        initials={props.initials}
        section={activeSection}
        sessionFooter={props.sessionFooter}
      />
      <div className="app-content">
        <ConsoleTopbar section={activeSection} pageTitle={pageTitle} initials={props.initials} />
        <main id="main-content" className="main">{props.children}</main>
      </div>
    </div>
  );
}
