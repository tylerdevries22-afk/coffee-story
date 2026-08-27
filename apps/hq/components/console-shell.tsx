'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, ReactNode, RefObject } from 'react';

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

const SYSTEM_SECTION: ConsoleSection = {
  key: 'system',
  title: 'System',
  icon: 'activity',
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

type ConsoleRailProps = Pick<
  ConsoleShellProps,
  'brandName' | 'initials' | 'sections' | 'statusHref' | 'sessionFooter'
> & {
  readonly isOpen: boolean;
  readonly isHidden: boolean;
  readonly onClose: () => void;
  readonly closeButtonRef: RefObject<HTMLButtonElement | null>;
};

function ConsoleRail({
  brandName,
  initials,
  sections,
  statusHref,
  sessionFooter,
  isOpen,
  isHidden,
  onClose,
  closeButtonRef,
}: ConsoleRailProps) {
  const keepFocusInRail = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (!isOpen || event.key !== 'Tab') return;
    const focusable = Array.from(
      event.currentTarget.querySelectorAll<HTMLElement>('a[href], button:not([disabled])'),
    );
    const first = focusable[0];
    const last = focusable.at(-1);
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <aside
      id="console-navigation"
      className={`console-rail${isOpen ? ' open' : ''}`}
      aria-label="Console navigation"
      aria-hidden={isHidden || undefined}
      inert={isHidden || undefined}
      onKeyDown={keepFocusInRail}
    >
      <header className="console-rail-header">
        <Link href="/" className="console-brand" aria-label={`${brandName} home`} onClick={onClose}>
          <span className="brand-glyph">{initials.charAt(0)}</span>
          <span className="console-brand-copy"><strong>{brandName}</strong><small>HQ console</small></span>
        </Link>
        <button
          ref={closeButtonRef}
          className="rail-close"
          type="button"
          onClick={onClose}
          aria-label="Close navigation"
          aria-hidden={!isOpen}
          tabIndex={isOpen ? 0 : -1}
        >
          <Icon name="close" size={17} />
        </button>
      </header>
      <nav className="console-rail-scroll" onClick={onClose}>
        {sections.map((section) => (
          <section className="console-nav-group" key={section.key} aria-labelledby={`nav-${section.key}`}>
            <h2 id={`nav-${section.key}`}>{section.title}</h2>
            <div className="console-nav-items">
              {section.items.map((item) => (
                <NavLink key={item.href} href={item.href} icon={item.icon} className="console-nav-link">
                  {item.label}
                </NavLink>
              ))}
            </div>
          </section>
        ))}
        <section className="console-nav-group" aria-labelledby="nav-system">
          <h2 id="nav-system">System</h2>
          <div className="console-nav-items">
            <NavLink href={statusHref} icon="activity" className="console-nav-link">
              System status
            </NavLink>
          </div>
        </section>
      </nav>
      <footer className="console-rail-footer" onClick={onClose}>
        {sessionFooter}
      </footer>
    </aside>
  );
}

function ConsoleTopbar({
  section,
  pageTitle,
  initials,
  navigationOpen,
  onOpenNavigation,
  triggerButtonRef,
}: {
  section: ConsoleSection;
  pageTitle: string;
  initials: string;
  navigationOpen: boolean;
  onOpenNavigation: () => void;
  triggerButtonRef: RefObject<HTMLButtonElement | null>;
}) {
  return (
    <header className="topbar">
      <div className="topbar-context">
        <button
          ref={triggerButtonRef}
          className="rail-trigger"
          type="button"
          onClick={onOpenNavigation}
          aria-controls="console-navigation"
          aria-expanded={navigationOpen}
          aria-label="Open navigation"
        >
          <Icon name="menu" size={18} />
        </button>
        <div className="breadcrumb" aria-label="Current page">
          <span className="breadcrumb-muted">{section.title}</span>
          <Icon name="chevron" size={15} />
          <strong>{pageTitle}</strong>
        </div>
      </div>
      <div className="topbar-actions">
        <span className="sync-state"><span className="sync-dot" /> Supabase synced</span>
        <span className="topbar-avatar" aria-hidden="true">{initials}</span>
      </div>
    </header>
  );
}

const MOBILE_NAV_QUERY = '(max-width: 720px)';

function subscribeToMobileNavChange(callback: () => void): () => void {
  const query = window.matchMedia(MOBILE_NAV_QUERY);
  query.addEventListener('change', callback);
  return () => query.removeEventListener('change', callback);
}

function isMobileNav(): boolean {
  return window.matchMedia(MOBILE_NAV_QUERY).matches;
}

/** Pathname-aware console chrome with one role-aware navigation rail. */
export function ConsoleShell(props: ConsoleShellProps) {
  const pathname = usePathname();
  const mobileNav = useSyncExternalStore(subscribeToMobileNavChange, isMobileNav, () => false);
  const [navigationOpen, setNavigationOpen] = useState(false);
  const drawerOpen = mobileNav && navigationOpen;
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const triggerButtonRef = useRef<HTMLButtonElement>(null);
  const navigationWasOpen = useRef(false);
  const matchedSection = consoleSectionForPath(props.sections, pathname);
  const activeSection = pathname.startsWith('/status/')
    ? SYSTEM_SECTION
    : matchedSection ?? props.sections[0] ?? FALLBACK_SECTION;
  const routeTitle = PAGE_TITLES[pathname]
    ?? (pathname.startsWith('/wall')
      ? 'Live wall'
      : pathname.startsWith('/status/') ? 'System status' : 'Workspace');
  const pageTitle = routeTitle === 'Workspace' ? activeSection.title : routeTitle;

  useEffect(() => {
    if (!drawerOpen) return undefined;
    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setNavigationOpen(false);
    };
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [drawerOpen]);

  useEffect(() => {
    if (!mobileNav) {
      navigationWasOpen.current = false;
      return;
    }
    if (drawerOpen) {
      navigationWasOpen.current = true;
      closeButtonRef.current?.focus();
    } else if (navigationWasOpen.current) {
      navigationWasOpen.current = false;
      triggerButtonRef.current?.focus();
    }
  }, [drawerOpen, mobileNav]);

  return (
    <div className="shell" style={props.theme}>
      <a
        className="skip-link"
        href="#main-content"
        aria-hidden={drawerOpen || undefined}
        tabIndex={drawerOpen ? -1 : undefined}
      >
        Skip to content
      </a>
      <ConsoleRail
        brandName={props.brandName}
        initials={props.initials}
        sections={props.sections}
        statusHref={props.statusHref}
        sessionFooter={props.sessionFooter}
        isOpen={drawerOpen}
        isHidden={mobileNav && !drawerOpen}
        onClose={() => setNavigationOpen(false)}
        closeButtonRef={closeButtonRef}
      />
      <button
        className={`rail-scrim${drawerOpen ? ' open' : ''}`}
        type="button"
        aria-label="Close navigation"
        aria-hidden="true"
        tabIndex={-1}
        onClick={() => setNavigationOpen(false)}
      />
      <div className="app-content" aria-hidden={drawerOpen || undefined} inert={drawerOpen || undefined}>
        <ConsoleTopbar
          section={activeSection}
          pageTitle={pageTitle}
          initials={props.initials}
          navigationOpen={drawerOpen}
          onOpenNavigation={() => setNavigationOpen(true)}
          triggerButtonRef={triggerButtonRef}
        />
        <main id="main-content" className="main">{props.children}</main>
      </div>
    </div>
  );
}
