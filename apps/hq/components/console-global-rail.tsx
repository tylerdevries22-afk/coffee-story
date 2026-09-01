'use client';

import { motion, useReducedMotion } from 'framer-motion';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { ConsoleSection } from '@/lib/console-navigation';

import { Icon } from './icon';

type GlobalRailProps = {
  readonly brandName: string;
  readonly initials: string;
  readonly sections: readonly ConsoleSection[];
  readonly section: ConsoleSection;
  readonly statusHref: string;
  readonly onNavigate: () => void;
};

function RailLink({ active, href, icon, label, onNavigate }: {
  readonly active: boolean;
  readonly href: string;
  readonly icon: ConsoleSection['icon'];
  readonly label: string;
  readonly onNavigate: () => void;
}) {
  const reducedMotion = useReducedMotion();
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Link
          href={href}
          className={`hq-global-link${active ? ' active' : ''}`}
          aria-current={active ? 'page' : undefined}
          aria-label={label}
          onClick={onNavigate}
        >
          {active ? (
            <motion.span
              className="hq-global-active"
              layoutId="hq-global-active"
              transition={reducedMotion ? { duration: 0 } : { duration: 0.2, ease: 'easeOut' }}
            />
          ) : null}
          <Icon name={icon} size={19} />
        </Link>
      </TooltipTrigger>
      <TooltipContent side="right" sideOffset={10}>{label}</TooltipContent>
    </Tooltip>
  );
}

export function ConsoleGlobalRail(props: GlobalRailProps) {
  const pathname = usePathname();
  const statusActive = pathname.startsWith('/status/');
  return (
    <aside className="hq-global-rail" aria-label="Workspace sections">
      <Link href="/" className="hq-global-logo" aria-label={`${props.brandName} overview`}>
        {props.initials.charAt(0)}
      </Link>
      <nav className="hq-global-nav" aria-label="Primary navigation">
        {props.sections.map((section) => (
          <RailLink
            key={section.key}
            active={!statusActive && section.key === props.section.key}
            href={section.home}
            icon={section.icon}
            label={section.title}
            onNavigate={props.onNavigate}
          />
        ))}
      </nav>
      <div className="hq-global-footer">
        <RailLink
          active={statusActive}
          href={props.statusHref}
          icon="activity"
          label="System status"
          onNavigate={props.onNavigate}
        />
        <Avatar size="sm" className="hq-global-avatar" aria-label="Current account">
          <AvatarFallback>{props.initials}</AvatarFallback>
        </Avatar>
      </div>
    </aside>
  );
}
