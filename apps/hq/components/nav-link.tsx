'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { Icon, type IconName } from './icon';

type NavLinkProps = {
  href: string;
  children: ReactNode;
  className?: string;
  icon?: IconName;
  ariaLabel?: string;
};

export function NavLink({ href, children, className, icon, ariaLabel }: NavLinkProps) {
  const pathname = usePathname();
  const active = href === '/' ? pathname === '/' : pathname.startsWith(href);
  const classes = [className, active ? 'active' : null].filter(Boolean).join(' ') || undefined;
  return (
    <Link href={href} className={classes} aria-current={active ? 'page' : undefined} aria-label={ariaLabel} title={ariaLabel}>
      {icon ? <span className="nav-link-icon"><Icon name={icon} size={17} /></span> : null}
      <span className="nav-link-label">{children}</span>
    </Link>
  );
}
