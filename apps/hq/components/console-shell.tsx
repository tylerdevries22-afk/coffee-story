'use client';

import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';

import { consoleSectionForPath } from '@/lib/console-navigation';

import { ConsoleCommandMenu } from './console-command-menu';
import { ConsoleNavigationRail } from './console-navigation-rail';
import { FALLBACK_SECTION, SYSTEM_SECTION } from '@/lib/console-shell-config';
import type { ConsoleShellProps } from './console-shell-types';
import { ConsoleTopbar } from './console-topbar';

const MOBILE_NAV_QUERY = '(max-width: 760px)';
const COMPACT_STORAGE_KEY = 'hq.navigation.compact.v1';

function subscribeToMobileNavChange(callback: () => void): () => void {
  const query = window.matchMedia(MOBILE_NAV_QUERY);
  query.addEventListener('change', callback);
  return () => query.removeEventListener('change', callback);
}

function isMobileNav(): boolean {
  return window.matchMedia(MOBILE_NAV_QUERY).matches;
}

/** Tenant-aware, pathname-aware chrome for every authenticated HQ surface. */
export function ConsoleShell(props: ConsoleShellProps) {
  const pathname = usePathname();
  const reducedMotion = useReducedMotion();
  const mobileNav = useSyncExternalStore(subscribeToMobileNavChange, isMobileNav, () => false);
  const [navigationOpen, setNavigationOpen] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const [compact, setCompact] = useState(false);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const triggerButtonRef = useRef<HTMLButtonElement>(null);
  const navigationWasOpen = useRef(false);
  const commandReturnFocus = useRef<HTMLElement | null>(null);
  const drawerOpen = mobileNav && navigationOpen;
  const matchedSection = consoleSectionForPath(props.sections, pathname);
  const activeSection = pathname.startsWith('/status/')
    ? SYSTEM_SECTION
    : matchedSection ?? props.sections[0] ?? FALLBACK_SECTION;

  useEffect(() => {
    try { setCompact(window.localStorage.getItem(COMPACT_STORAGE_KEY) === 'true'); } catch { /* Optional preference. */ }
  }, []);

  useEffect(() => {
    const onShortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLocaleLowerCase() === 'k') {
        event.preventDefault();
        setCommandOpen((current) => {
          if (current) {
            window.requestAnimationFrame(() => commandReturnFocus.current?.focus());
          } else {
            commandReturnFocus.current = document.activeElement as HTMLElement | null;
          }
          return !current;
        });
      }
    };
    document.addEventListener('keydown', onShortcut);
    return () => document.removeEventListener('keydown', onShortcut);
  }, []);

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
      setNavigationOpen(false);
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

  const openCommand = () => {
    commandReturnFocus.current = document.activeElement as HTMLElement | null;
    setCommandOpen(true);
  };
  const closeCommand = () => {
    setCommandOpen(false);
    window.requestAnimationFrame(() => commandReturnFocus.current?.focus());
  };
  const toggleCompact = () => {
    setCompact((current) => {
      const next = !current;
      try { window.localStorage.setItem(COMPACT_STORAGE_KEY, String(next)); } catch { /* Optional preference. */ }
      return next;
    });
  };

  return (
    <div className={`hq-shell${compact ? ' compact' : ''}`} style={props.theme}>
      <a className="hq-skip-link" href="#main-content">Skip to content</a>
      <ConsoleTopbar
        section={activeSection}
        brandName={props.brandName}
        initials={props.initials}
        dataMode={props.dataMode}
        compact={compact}
        mobile={mobileNav}
        navigationOpen={drawerOpen}
        overlayOpen={drawerOpen || commandOpen}
        onOpenNavigation={() => setNavigationOpen(true)}
        onToggleCompact={toggleCompact}
        triggerButtonRef={triggerButtonRef}
        statusHref={props.statusHref}
        orgSwitcher={props.orgSwitcher}
        locationSwitcher={props.locationSwitcher}
      />
      <ConsoleNavigationRail
        {...props}
        section={activeSection}
        compact={compact}
        mobile={mobileNav}
        isOpen={drawerOpen}
        isHidden={(mobileNav && !drawerOpen) || commandOpen}
        onClose={() => setNavigationOpen(false)}
        onOpenCommand={openCommand}
        closeButtonRef={closeButtonRef}
      />
      <div
        className="hq-workspace"
        aria-hidden={commandOpen || drawerOpen || undefined}
        inert={commandOpen || drawerOpen || undefined}
      >
        <main id="main-content" className="hq-main">{props.children}</main>
      </div>
      <AnimatePresence>
        {drawerOpen ? (
          <motion.button
            className="hq-rail-scrim"
            type="button"
            aria-label="Dismiss navigation"
            tabIndex={-1}
            initial={reducedMotion ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={reducedMotion ? { opacity: 0 } : { opacity: 0 }}
            transition={{ duration: reducedMotion ? 0 : 0.18 }}
            onClick={() => setNavigationOpen(false)}
          />
        ) : null}
      </AnimatePresence>
      <ConsoleCommandMenu
        open={commandOpen}
        sections={props.sections}
        statusHref={props.statusHref}
        onClose={closeCommand}
      />
    </div>
  );
}
