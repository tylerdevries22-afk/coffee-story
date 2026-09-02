'use client';

import { useRef, useSyncExternalStore, type KeyboardEvent, type ReactNode } from 'react';

import type { IconName } from './icon';
import { Icon } from './icon';

export type AppsView = 'wall' | 'table';

/** Versioned like the other console preferences (`hq.navigation.compact.v1`). */
const STORAGE_KEY = 'hq.apps.view.v1';
const VIEWS: readonly { readonly id: AppsView; readonly label: string; readonly icon: IconName }[] = [
  { id: 'wall', label: 'Wall', icon: 'wall' },
  { id: 'table', label: 'Table', icon: 'panel' },
];

const listeners = new Set<() => void>();

function stored(): AppsView {
  try { return window.localStorage.getItem(STORAGE_KEY) === 'table' ? 'table' : 'wall'; } catch { return 'wall'; }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener('storage', listener);
  return () => { listeners.delete(listener); window.removeEventListener('storage', listener); };
}

/**
 * The two ways to look at this page: the wall of live device previews, and the
 * table of production installations. Only the chosen one is mounted, because
 * the wall runs a simulation and the table fetches diagnostics; neither should
 * pay for the other, and a hidden canvas measures zero and would refit itself
 * to nothing. Wall is the default, and the choice is remembered per browser:
 * the server renders the default and the stored view is picked up at
 * hydration, the same way the console remembers a collapsed navigation.
 */
export function AppsViewTabs({ onReset, table, wall }: {
  readonly onReset: () => void;
  readonly wall: ReactNode;
  readonly table: ReactNode;
}) {
  const view = useSyncExternalStore(subscribe, stored, () => 'wall' as AppsView);
  const tabsRef = useRef<HTMLDivElement>(null);
  const choose = (next: AppsView) => {
    try { window.localStorage.setItem(STORAGE_KEY, next); } catch { /* A view that cannot be saved still works for this visit. */ }
    for (const listener of listeners) listener();
  };
  const move = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const index = VIEWS.findIndex((entry) => entry.id === view);
    const next = VIEWS[(index + step + VIEWS.length) % VIEWS.length];
    if (!next) return;
    choose(next.id);
    tabsRef.current?.querySelector<HTMLButtonElement>(`#apps-view-tab-${next.id}`)?.focus();
  };
  return (
    <div className="apps-view-switch" data-view={view}>
      <div className="apps-view-controlbar">
        <div aria-label="Apps view" className="apps-view-tabs" onKeyDown={move} ref={tabsRef} role="tablist">
          {VIEWS.map((entry) => (
            <button
              aria-controls="apps-view-panel"
              aria-selected={entry.id === view}
              className="apps-view-tab"
              id={`apps-view-tab-${entry.id}`}
              key={entry.id}
              onClick={() => choose(entry.id)}
              role="tab"
              tabIndex={entry.id === view ? 0 : -1}
              type="button"
            >
              <Icon name={entry.icon} />{entry.label}
            </button>
          ))}
        </div>
        <button className="apps-wall-reset" onClick={onReset} type="button">Reset</button>
      </div>
      <div aria-labelledby={`apps-view-tab-${view}`} className="apps-view-panel" id="apps-view-panel" role="tabpanel" tabIndex={-1}>
        {view === 'wall' ? wall : table}
      </div>
    </div>
  );
}
