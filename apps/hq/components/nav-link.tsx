'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { Icon, type IconName } from './icon';
import { pathMatchesHref } from '@/lib/navigation-path';

type NavLinkProps = {
  href: string;
  children: ReactNode;
  className?: string;
  icon?: IconName;
  ariaLabel?: string;
  active?: boolean;
};

export function NavLink({ href, children, className, icon, ariaLabel, active }: NavLinkProps) {
  const pathname = usePathname();
  const isActive = active ?? pathMatchesHref(pathname, href);
  const classes = [className, isActive ? 'active' : null].filter(Boolean).join(' ') || undefined;
  return (
    <Link href={href} className={classes} aria-current={isActive ? 'page' : undefined} aria-label={ariaLabel} title={ariaLabel}>
      {icon ? <span className="nav-link-icon"><Icon name={icon} size={17} /></span> : null}
      <span className="nav-link-label">{children}</span>
    </Link>
  );
}
