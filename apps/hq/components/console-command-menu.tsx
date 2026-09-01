'use client';

import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';

import type { ConsoleSection } from '@/lib/console-navigation';
import { Button } from '@/components/ui/button';

import { Icon } from './icon';

type CommandMenuProps = {
  readonly open: boolean;
  readonly sections: readonly ConsoleSection[];
  readonly statusHref: string;
  readonly onClose: () => void;
};

function trapDialogFocus(event: ReactKeyboardEvent<HTMLElement>) {
  if (event.key !== 'Tab') return;
  const controls = Array.from(
    event.currentTarget.querySelectorAll<HTMLElement>('input, a[href], button:not([disabled])'),
  );
  const first = controls[0];
  const last = controls.at(-1);
  if (!first || !last) return;
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

export function ConsoleCommandMenu({ open, sections, statusHref, onClose }: CommandMenuProps) {
  const pathname = usePathname();
  const reducedMotion = useReducedMotion();
  const searchRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const groups = useMemo(() => [
    ...sections.map((section) => ({ title: section.title, items: section.items })),
    { title: 'System', items: [{ href: statusHref, label: 'System status', icon: 'activity' as const }] },
  ], [sections, statusHref]);
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const visibleGroups = groups.map((group) => ({
    ...group,
    items: group.items.filter((item) => `${group.title} ${item.label}`.toLocaleLowerCase()
      .includes(normalizedQuery)),
  })).filter((group) => group.items.length > 0);
  const resultCount = visibleGroups.reduce((count, group) => count + group.items.length, 0);

  useEffect(() => {
    if (!open) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    searchRef.current?.focus();
    return () => { document.body.style.overflow = previousOverflow; };
  }, [open]);

  useEffect(() => {
    if (!open) setQuery('');
  }, [open]);

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          className="hq-command-layer"
          initial={reducedMotion ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: reducedMotion ? 0 : 0.16 }}
        >
          <button className="hq-command-backdrop" type="button" aria-label="Dismiss search" onClick={onClose} />
          <motion.section
            className="hq-command-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="command-title"
            initial={reducedMotion ? false : { opacity: 0, y: -10, scale: 0.985 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.99 }}
            transition={{ duration: reducedMotion ? 0 : 0.2, ease: [0.16, 1, 0.3, 1] }}
            onKeyDown={(event) => {
              if (event.key === 'Escape') onClose();
              trapDialogFocus(event);
            }}
          >
            <header className="hq-command-search">
              <Icon name="search" size={18} />
              <label htmlFor="hq-command-input" className="sr-only">Search the HQ console</label>
              <input
                ref={searchRef}
                id="hq-command-input"
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search pages and actions"
                autoComplete="off"
              />
              <Button variant="secondary" size="xs" type="button" onClick={onClose} aria-label="Close search">Esc</Button>
            </header>
            <div className="hq-command-results">
              <div className="hq-command-summary">
                <h2 id="command-title">Go to</h2>
                <span aria-live="polite">{resultCount} {resultCount === 1 ? 'result' : 'results'}</span>
              </div>
              {visibleGroups.map((group) => (
                <section className="hq-command-group" key={group.title}>
                  <h3>{group.title}</h3>
                  {group.items.map((item) => (
                    <Link
                      href={item.href}
                      key={`${group.title}-${item.href}`}
                      onClick={onClose}
                      aria-current={pathname === item.href ? 'page' : undefined}
                    >
                      <Icon name={item.icon} size={17} />
                      <span>{item.label}</span>
                      <Icon name="chevron" size={15} />
                    </Link>
                  ))}
                </section>
              ))}
              {resultCount === 0 ? (
                <div className="hq-command-empty">
                  <strong>No matching destination</strong>
                  <p>Try a page name such as locations, catalog, analytics, or staff.</p>
                </div>
              ) : null}
            </div>
          </motion.section>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
