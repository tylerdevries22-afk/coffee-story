'use client';

/**
 * The franchise scope controls that frame the console: organization and
 * location switchers lead the topbar's compact page trail. They are exported
 * separately so the shell can place each control in its owning region. Both are custom popovers rather than a native
 * <select> so each row can carry a badge and a checkmark, and each row is a
 * submit button posting to a server action -- selecting is a server-side,
 * re-authorized write, never client navigation.
 *
 * Location only renders when the selected org has locations, so a single-office
 * tenant shows one control and the operator view shows the region list.
 */
import Link from 'next/link';
import { useEffect, useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';

import { Icon } from './icon';

type Option = {
  readonly id: string;
  readonly label: string;
  readonly hint?: string;
  readonly badge?: string;
};

type ScopeSwitcherProps = {
  readonly options: readonly Option[];
  readonly selectedId: string | null;
  readonly fieldName: string;
  readonly action: (formData: FormData) => void;
  readonly icon: 'brand' | 'locations';
  readonly ariaLabel: string;
  readonly placeholder: string;
  /** Menu edge to anchor to: 'start' (left) for left-of-topbar triggers. */
  readonly align?: 'start' | 'end';
  /** Extra class on the trigger so the shell can shape it (chip vs. pill). */
  readonly triggerClassName?: string;
  /** Render the trigger as the rail's branded organization control. */
  readonly showBrandMark?: boolean;
  /** Hidden fields posted alongside the choice (e.g. the owning org id). */
  readonly hidden?: Readonly<Record<string, string>>;
  /** Optional action row pinned under the options (e.g. "New organization"). */
  readonly footer?: ReactNode;
};

const SEARCH_THRESHOLD = 6;

function Check() {
  return (
    <svg className="scope-check" width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m5 12 5 5 9-11" />
    </svg>
  );
}

function ScopeSwitcher({ options, selectedId, fieldName, action, icon, ariaLabel, placeholder, align = 'end', triggerClassName, showBrandMark = false, hidden, footer }: ScopeSwitcherProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const selected = options.find((option) => option.id === selectedId) ?? null;
  const showSearch = options.length > SEARCH_THRESHOLD;
  const needle = query.trim().toLowerCase();
  const visible = needle
    ? options.filter((option) => option.label.toLowerCase().includes(needle) || option.hint?.toLowerCase().includes(needle))
    : options;

  return (
    <div className="scope-switcher" ref={containerRef}>
      <button
        type="button"
        className={`scope-trigger${triggerClassName ? ` ${triggerClassName}` : ''}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        aria-label={ariaLabel}
        onClick={() => { setOpen((value) => !value); setQuery(''); }}
      >
        {showBrandMark ? (
          <span className="scope-trigger-brand-glyph" aria-hidden="true">
            {(selected?.label ?? placeholder).charAt(0).toUpperCase()}
          </span>
        ) : <Icon name={icon} size={15} className="scope-trigger-icon" />}
        <span className={showBrandMark ? 'scope-trigger-copy' : undefined}>
          <span className="scope-trigger-label">{selected?.label ?? placeholder}</span>
          {showBrandMark ? <span className="scope-trigger-subtitle">HQ console</span> : null}
        </span>
        <Icon name="chevron" size={14} className="scope-trigger-chevron" />
      </button>
      {open ? (
        <div className={`scope-menu align-${align}`} id={menuId} role="menu" aria-label={ariaLabel}>
          {showSearch ? (
            <input
              className="scope-search"
              type="search"
              value={query}
              autoFocus
              placeholder="Search"
              aria-label={`Search ${ariaLabel}`}
              onChange={(event) => setQuery(event.target.value)}
            />
          ) : null}
          <div className="scope-menu-scroll">
            {visible.map((option) => (
              <form key={option.id} action={action}>
                {hidden ? Object.entries(hidden).map(([name, value]) => (
                  <input key={name} type="hidden" name={name} value={value} />
                )) : null}
                <button
                  type="submit"
                  name={fieldName}
                  value={option.id}
                  role="menuitemradio"
                  aria-checked={option.id === selectedId}
                  className={`scope-option${option.id === selectedId ? ' selected' : ''}`}
                  onClick={() => setOpen(false)}
                >
                  <span className="scope-option-copy">
                    <span className="scope-option-label">{option.label}</span>
                    {option.hint ? <span className="scope-option-hint">{option.hint}</span> : null}
                  </span>
                  {option.badge ? <span className="scope-badge">{option.badge}</span> : null}
                  {option.id === selectedId ? <Check /> : null}
                </button>
              </form>
            ))}
            {visible.length === 0 ? <p className="scope-empty">No matches</p> : null}
          </div>
          {footer ? <div className="scope-menu-footer" onClick={() => setOpen(false)}>{footer}</div> : null}
        </div>
      ) : null}
    </div>
  );
}

export type OrganizationSwitcherProps = {
  readonly organizations: readonly { id: string; name: string; kind: 'operator' | 'brand' }[];
  readonly organizationId: string | null;
  readonly selectOrganizationAction: (formData: FormData) => void;
  /** When set, the org menu shows a "New organization" row (platform admins). */
  readonly createOrgHref?: string;
  /** Use the full branded trigger in the navigation rail. */
  readonly rail?: boolean;
};

/** The organization menu, shown as the branded topbar control. */
export function OrganizationSwitcher(props: OrganizationSwitcherProps) {
  if (props.organizations.length === 0) return null;
  const orgOptions: Option[] = props.organizations.map((org) => ({
    id: org.id,
    label: org.name,
    badge: org.kind === 'operator' ? 'Operator' : undefined,
  }));
  return (
    <ScopeSwitcher
      options={orgOptions}
      selectedId={props.organizationId}
      fieldName="orgId"
      action={props.selectOrganizationAction}
      icon="brand"
      ariaLabel="Switch organization"
      placeholder="Select organization"
      align="start"
      triggerClassName={`scope-trigger-org${props.rail ? ' scope-trigger-rail' : ''}`}
      showBrandMark={props.rail}
      footer={props.createOrgHref ? (
        <Link href={props.createOrgHref} className="scope-create" role="menuitem">
          <span className="scope-create-plus" aria-hidden="true">+</span> New organization
        </Link>
      ) : undefined}
    />
  );
}

export type LocationSwitcherProps = {
  readonly locations: readonly { id: string; name: string; city: string }[];
  readonly locationId: string | null;
  readonly selectLocationAction: (formData: FormData) => void;
};

const ALL_LOCATIONS: Option = { id: '', label: 'All locations' };

/** The location pill that follows the breadcrumb; hidden when there are none. */
export function LocationSwitcher(props: LocationSwitcherProps) {
  if (props.locations.length === 0) return null;
  const locationOptions: Option[] = [
    ALL_LOCATIONS,
    ...props.locations.map((location) => ({ id: location.id, label: location.name, hint: location.city })),
  ];
  return (
    <ScopeSwitcher
      options={locationOptions}
      selectedId={props.locationId ?? ''}
      fieldName="locationId"
      action={props.selectLocationAction}
      icon="locations"
      ariaLabel="Switch location"
      placeholder="All locations"
      align="start"
      triggerClassName="scope-trigger-location"
    />
  );
}
