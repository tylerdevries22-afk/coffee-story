'use client';

import Link from 'next/link';
import { Fragment } from 'react';
import type { ReactNode, RefObject } from 'react';

import { Button } from '@/components/ui/button';
import type { ConsoleSection } from '@/lib/console-navigation';

import { Icon } from './icon';

type ConsoleTopbarProps = {
  readonly section: ConsoleSection;
  readonly brandName: string;
  readonly initials: string;
  readonly dataMode: 'hosted' | 'preview';
  readonly compact: boolean;
  readonly mobile: boolean;
  readonly navigationOpen: boolean;
  readonly overlayOpen: boolean;
  readonly onOpenNavigation: () => void;
  readonly onToggleCompact: () => void;
  readonly triggerButtonRef: RefObject<HTMLButtonElement | null>;
  readonly statusHref: string;
  readonly orgSwitcher?: ReactNode;
  readonly locationSwitcher?: ReactNode;
};

export function ConsoleTopbar(props: ConsoleTopbarProps) {
  const toggleNavigation = props.mobile ? props.onOpenNavigation : props.onToggleCompact;
  const navigationExpanded = props.mobile ? props.navigationOpen : !props.compact;
  const navigationLabel = props.mobile
    ? 'Open navigation'
    : props.compact ? 'Show navigation' : 'Hide navigation';

  return (
    <header
      className="hq-topbar"
      aria-hidden={props.overlayOpen || undefined}
      inert={props.overlayOpen || undefined}
    >
      <div className="hq-topbar-leading">
        <Button
          ref={props.triggerButtonRef}
          variant="ghost"
          size="icon"
          className="hq-shell-mark"
          type="button"
          onClick={toggleNavigation}
          aria-controls="console-navigation"
          aria-expanded={navigationExpanded}
          aria-label={navigationLabel}
        >
          <span aria-hidden="true">{props.initials.charAt(0)}</span>
        </Button>
        <nav className="hq-topbar-context" aria-label="Workspace context">
          {props.orgSwitcher ? (
            <Fragment key="organization-switcher">{props.orgSwitcher}</Fragment>
          ) : <strong className="hq-topbar-brand">{props.brandName}</strong>}
          <span className="hq-topbar-divider" aria-hidden="true">/</span>
          <Link href={props.section.home} className="hq-topbar-section">
            {props.section.title}
            <Icon name="chevron" size={14} />
          </Link>
          {props.locationSwitcher ? (
            <>
              <span className="hq-topbar-divider" aria-hidden="true">/</span>
              <Fragment key="location-switcher">{props.locationSwitcher}</Fragment>
            </>
          ) : null}
        </nav>
      </div>

      <div className="hq-topbar-actions">
        <Link href={props.statusHref} className="hq-system-status">
          <Icon name="activity" size={18} />
          <strong>System</strong>
          <span className={props.dataMode}>{props.dataMode === 'hosted' ? 'Live' : 'Preview'}</span>
        </Link>
      </div>
    </header>
  );
}
