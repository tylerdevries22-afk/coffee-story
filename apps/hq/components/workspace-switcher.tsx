'use client';

import Link from 'next/link';
import { useActionState, useEffect, useId, useRef, useState } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';

import type { WorkspaceActionState } from '@/app/actions/workspace';

import { Icon } from './icon';
import { OrganizationLogo } from './organization-logo';

type Option = { readonly id: string; readonly label: string; readonly hint?: string; readonly badge?: string; readonly organization?: boolean };
type ScopeAction = (state: WorkspaceActionState, data: FormData) => Promise<WorkspaceActionState>;
type FocusTarget = 'search' | 'first' | 'last' | 'selected';
type ScopeSwitcherProps = {
  readonly options: readonly Option[];
  readonly selectedId: string | null;
  readonly fieldName: string;
  readonly action: ScopeAction;
  readonly icon: 'brand' | 'locations';
  readonly ariaLabel: string;
  readonly placeholder: string;
  readonly align?: 'start' | 'end';
  readonly triggerClassName?: string;
  readonly hidden?: Readonly<Record<string, string>>;
  readonly footer?: ReactNode;
};

const IDLE: WorkspaceActionState = { status: 'idle' };
const SEARCH_THRESHOLD = 6;

function Check() {
  return <svg className="scope-check" width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m5 12 5 5 9-11" /></svg>;
}

function ScopeSwitcher(props: ScopeSwitcherProps) {
  const { options, selectedId, fieldName, action, icon, ariaLabel, placeholder } = props;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [state, submit, pending] = useActionState(action, IDLE);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const focusTarget = useRef<FocusTarget>('search');
  const menuId = useId();
  const selected = options.find((option) => option.id === selectedId) ?? null;
  const needle = query.trim().toLowerCase();
  const visible = needle ? options.filter((option) => option.label.toLowerCase().includes(needle)
    || option.hint?.toLowerCase().includes(needle)) : options;

  const restoreTrigger = () => requestAnimationFrame(() => triggerRef.current?.focus());
  const close = (restore = false) => {
    if (pending) return;
    setOpen(false);
    if (restore) restoreTrigger();
  };
  const openAt = (target: FocusTarget) => {
    focusTarget.current = target;
    setQuery('');
    setOpen(true);
  };

  useEffect(() => {
    if (state.status !== 'success') return;
    setOpen(false);
    requestAnimationFrame(() => triggerRef.current?.focus());
  }, [state]);

  useEffect(() => {
    if (!open) return undefined;
    const frame = requestAnimationFrame(() => {
      const menu = menuRef.current;
      const items = menu?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]');
      const target = focusTarget.current === 'search' ? menu?.querySelector<HTMLInputElement>('.scope-search')
        : focusTarget.current === 'last' ? items?.item((items.length ?? 1) - 1)
          : focusTarget.current === 'selected' ? menu?.querySelector<HTMLButtonElement>('[aria-checked="true"]')
            : items?.item(0);
      (target ?? items?.item(0))?.focus();
    });
    const onPointerDown = (event: MouseEvent) => {
      if (!pending && !containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape' && !pending) {
        event.preventDefault();
        setOpen(false);
        requestAnimationFrame(() => triggerRef.current?.focus());
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, pending]);

  const moveFocus = (event: KeyboardEvent<HTMLElement>) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    if (event.target instanceof HTMLInputElement && (event.key === 'Home' || event.key === 'End')) return;
    event.preventDefault();
    const items = [...(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]:not(:disabled)') ?? [])];
    if (items.length === 0) return;
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
      : event.key === 'ArrowDown' ? (current + 1) % items.length : (current <= 0 ? items.length : current) - 1;
    items[next]?.focus();
  };

  return <div className="scope-switcher" ref={containerRef}>
    <button ref={triggerRef} type="button" disabled={pending}
      className={`scope-trigger${props.triggerClassName ? ` ${props.triggerClassName}` : ''}`}
      aria-haspopup="menu" aria-expanded={open} aria-controls={menuId} aria-label={ariaLabel} aria-busy={pending}
      onClick={() => open ? close() : openAt(options.length > SEARCH_THRESHOLD ? 'search' : 'selected')}
      onKeyDown={(event) => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault(); openAt(event.key === 'ArrowDown' ? 'first' : 'last');
        }
      }}>
      {selected?.organization ? <OrganizationLogo id={selected.id} name={selected.label} />
        : <span className="scope-trigger-icon-frame"><Icon name={icon} size={16} className="scope-trigger-icon" /></span>}
      <span className="scope-trigger-copy">
        <span className="scope-trigger-label">{selected?.label ?? placeholder}</span>
        <span className="scope-trigger-subtitle">{selected?.hint ?? (icon === 'brand' ? 'Organization' : 'Location scope')}</span>
      </span>
      <Icon name="chevron" size={14} className="scope-trigger-chevron" />
    </button>
    {open ? <div ref={menuRef} className={`scope-menu align-${props.align ?? 'end'}`} id={menuId}
      role="menu" aria-label={ariaLabel} aria-busy={pending} onKeyDown={moveFocus}>
      {options.length > SEARCH_THRESHOLD ? <input className="scope-search" type="search" value={query}
        placeholder="Search" aria-label={`Search ${ariaLabel}`} onChange={(event) => setQuery(event.target.value)} /> : null}
      <div className="scope-menu-scroll">
        {visible.map((option) => <form key={option.id} action={submit} role="none">
          {props.hidden ? Object.entries(props.hidden).map(([name, value]) => <input key={name} type="hidden" name={name} value={value} />) : null}
          <button type="submit" name={fieldName} value={option.id} role="menuitemradio" disabled={pending}
            aria-checked={option.id === selectedId} className={`scope-option${option.id === selectedId ? ' selected' : ''}`}>
            {option.organization ? <OrganizationLogo id={option.id} name={option.label} compact />
              : icon === 'locations' ? <span className="scope-option-icon"><Icon name="locations" size={14} /></span> : null}
            <span className="scope-option-copy"><span className="scope-option-label">{option.label}</span>
              {option.hint ? <span className="scope-option-hint">{option.hint}</span> : null}</span>
            {option.badge ? <span className="scope-badge">{option.badge}</span> : null}
            {option.id === selectedId ? <Check /> : null}
          </button>
        </form>)}
        {visible.length === 0 ? <p className="scope-empty">No matches</p> : null}
      </div>
      {pending ? <p className="scope-empty" role="status">Switching workspace…</p>
        : state.status === 'error' ? <p className="scope-empty" role="alert">{state.message}</p> : null}
      {props.footer && !pending ? <div className="scope-menu-footer" onClick={() => close()}>{props.footer}</div> : null}
    </div> : null}
  </div>;
}

export type OrganizationSwitcherProps = {
  readonly organizations: readonly { id: string; name: string; kind: 'operator' | 'brand' }[];
  readonly organizationId: string | null;
  readonly selectOrganizationAction: ScopeAction;
  readonly createOrgHref?: string;
  readonly rail?: boolean;
};

export function OrganizationSwitcher(props: OrganizationSwitcherProps) {
  if (props.organizations.length === 0) return null;
  const options = props.organizations.map((org) => ({ id: org.id, label: org.name, organization: true, badge: org.kind === 'operator' ? 'Operator' : undefined }));
  const footer = props.createOrgHref ? <Link href={props.createOrgHref} className="scope-create" role="menuitem"><span className="scope-create-plus" aria-hidden="true">+</span> New organization</Link> : undefined;
  return <ScopeSwitcher options={options} selectedId={props.organizationId} fieldName="orgId" action={props.selectOrganizationAction}
    icon="brand" ariaLabel="Switch organization" placeholder="Select organization" align="start"
    triggerClassName={`scope-trigger-org${props.rail ? ' scope-trigger-rail' : ''}`} footer={footer} />;
}

export type LocationSwitcherProps = {
  readonly locations: readonly { id: string; name: string; city: string }[];
  readonly locationId: string | null;
  readonly selectLocationAction: ScopeAction;
};

export function LocationSwitcher(props: LocationSwitcherProps) {
  if (props.locations.length === 0) return null;
  const options = [{ id: '', label: 'All locations', hint: 'Entire organization' }, ...props.locations.map((location) => ({ id: location.id, label: location.name, hint: location.city }))];
  return <ScopeSwitcher options={options} selectedId={props.locationId ?? ''} fieldName="locationId" action={props.selectLocationAction}
    icon="locations" ariaLabel="Switch location" placeholder="All locations" align="end" triggerClassName="scope-trigger-location" />;
}
