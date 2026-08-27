'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

export function NavLink({ href, children, className }: { href: string; children: ReactNode; className?: string }) {
  const pathname = usePathname();
  const active = href === '/' ? pathname === '/' : pathname.startsWith(href);
  const classes = [className, active ? 'active' : null].filter(Boolean).join(' ') || undefined;
  return (
    <Link href={href} className={classes} aria-current={active ? 'page' : undefined}>
      {children}
    </Link>
  );
}
