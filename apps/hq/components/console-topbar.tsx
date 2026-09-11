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
  readonly dataMode: 'hosted' | 'preview';
  readonly mobile: boolean;
  readonly navigationOpen: boolean;
  readonly overlayOpen: boolean;
  readonly onOpenNavigation: () => void;
  readonly triggerButtonRef: RefObject<HTMLButtonElement | null>;
  readonly statusHref: string;
  readonly orgSwitcher?: ReactNode;
  readonly locationSwitcher?: ReactNode;
};

export function ConsoleTopbar(props: ConsoleTopbarProps) {
  return (
    <header
      className="hq-topbar"
      aria-hidden={props.overlayOpen || undefined}
      inert={props.overlayOpen || undefined}
    >
      <div className="hq-topbar-leading">
        {props.mobile ? (
          <Button
            ref={props.triggerButtonRef}
            variant="ghost"
            size="icon"
            className="hq-shell-mark"
            type="button"
            onClick={props.onOpenNavigation}
            aria-controls="console-navigation"
            aria-expanded={props.navigationOpen}
            aria-label="Open navigation"
          >
            <Icon name="menu" size={19} />
          </Button>
        ) : null}
        <nav className="hq-topbar-context" aria-label="Workspace context">
          {props.orgSwitcher ? (
            <Fragment key="organization-switcher">{props.orgSwitcher}</Fragment>
          ) : <strong className="hq-topbar-brand">{props.brandName}</strong>}
          {props.locationSwitcher ? (
            <Fragment key="location-switcher">{props.locationSwitcher}</Fragment>
          ) : null}
          <span className="hq-topbar-divider" aria-hidden="true">/</span>
          <Link href={props.section.home} className="hq-topbar-section">
            {props.section.title}
            <Icon name="chevron" size={14} />
          </Link>
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
