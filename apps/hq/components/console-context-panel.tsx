'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Fragment } from 'react';

import { Button } from '@/components/ui/button';
import { bestMatchingHref } from '@/lib/navigation-path';

import { Icon } from './icon';
import { NavLink } from './nav-link';
import type { ConsoleRailProps } from './console-shell-types';

type ContextPanelProps = Pick<
  ConsoleRailProps,
  | 'brandName'
  | 'closeButtonRef'
  | 'compact'
  | 'dataMode'
  | 'initials'
  | 'isOpen'
  | 'mobile'
  | 'onClose'
  | 'onOpenCommand'
  | 'section'
  | 'sections'
  | 'sessionFooter'
  | 'statusHref'
>;

export function ConsoleContextPanel(props: ContextPanelProps) {
  const pathname = usePathname();
  const contextHidden = props.compact && !props.mobile;
  const modeLabel = props.dataMode === 'hosted' ? 'Live' : 'Preview';

  return (
    <aside
      className="hq-context-panel"
      aria-label="Workspace navigation"
      aria-hidden={contextHidden || undefined}
      inert={contextHidden || undefined}
    >
      <header className="hq-context-mobile-header">
        <span className="hq-context-mobile-mark" aria-hidden="true">{props.initials}</span>
        <strong>{props.brandName}</strong>
        <Button
          ref={props.closeButtonRef}
          variant="ghost"
          size="icon"
          className="hq-context-close"
          type="button"
          onClick={props.onClose}
          aria-label="Close navigation"
          tabIndex={props.isOpen ? 0 : -1}
        >
          <Icon name="close" size={18} />
        </Button>
      </header>

      <div className="hq-sidebar-tools">
        <button className="hq-sidebar-search" type="button" onClick={props.onOpenCommand}>
          <Icon name="search" size={18} />
          <span>Search...</span>
          <kbd>⌘K</kbd>
        </button>
      </div>

      <nav className="hq-context-scroll" onClick={props.onClose}>
        <p className="hq-context-eyebrow">Workspace</p>
        <div className="hq-section-list">
          {props.sections.map((navSection) => {
            const active = navSection.key === props.section.key;
            const activeHref = bestMatchingHref(pathname, navSection.items.map((item) => item.href));
            return (
              <section className={`hq-section${active ? ' active' : ''}`} key={navSection.key}>
                <Link className="hq-section-root" href={navSection.home}>
                  <Icon name={navSection.icon} size={19} />
                  <span>{navSection.title}</span>
                  {navSection.items.length > 1 ? (
                    <Icon name="chevron" size={15} className="hq-section-chevron" />
                  ) : null}
                </Link>
                {active && navSection.items.length > 1 ? (
                  <div className="hq-section-children">
                    {navSection.items.map((item) => (
                      <NavLink
                        key={item.href}
                        href={item.href}
                        className="hq-context-link"
                        active={item.href === activeHref}
                      >
                        {item.label}
                      </NavLink>
                    ))}
                  </div>
                ) : null}
              </section>
            );
          })}
        </div>
      </nav>

      <footer className="hq-context-footer">
        <Link href={props.statusHref} className="hq-workspace-state" onClick={props.onClose}>
          <span className="hq-workspace-state-copy">
            <strong>Workspace services</strong>
            <small>Tenant health and release status</small>
          </span>
          <span className={`hq-workspace-badge ${props.dataMode}`}>{modeLabel}</span>
          <span className="hq-status-graphic" aria-hidden="true">
            <i /><i /><i /><i /><i /><i />
          </span>
        </Link>
        <Fragment key="session-footer">{props.sessionFooter}</Fragment>
      </footer>
    </aside>
  );
}
