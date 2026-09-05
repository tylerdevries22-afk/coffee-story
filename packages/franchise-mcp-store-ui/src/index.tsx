'use client';

import type { ReactNode } from 'react';
import { useMemo, useState } from 'react';

import styles from './styles.module.css';

export type McpStoreStatus = 'connected' | 'reconnect' | 'not_connected' | 'unavailable';

export type McpStoreEntry = {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly type: string;
  readonly status: McpStoreStatus;
  readonly accountName?: string | null;
  readonly readiness?: string | null;
  readonly popular?: boolean;
  readonly selectable?: boolean;
  readonly detailHref?: string | null;
  readonly connectHref?: string | null;
  readonly connectLabel?: string;
};

type Filter = 'all' | 'connected' | 'not_connected';

export type McpStoreProps = {
  readonly entries: readonly McpStoreEntry[];
  readonly mode?: 'manage' | 'select';
  readonly outcome?: 'connected' | 'error';
  readonly selectedIds?: readonly string[];
  readonly onSelectionChange?: (ids: string[]) => void;
  readonly renderIcon?: (entry: McpStoreEntry, size: number) => ReactNode;
};

function statusLabel(status: McpStoreStatus): string {
  if (status === 'connected') return 'Connected';
  if (status === 'reconnect') return 'Reconnect';
  if (status === 'unavailable') return 'Unavailable';
  return 'Not connected';
}

function selectionLabel(entry: McpStoreEntry, selected: boolean): string {
  if (selected) return 'Included';
  return entry.selectable === false ? 'Unavailable' : 'Add';
}

function SelectionStatus({ entry, selected }: {
  readonly entry: McpStoreEntry;
  readonly selected: boolean;
}) {
  const unavailable = entry.selectable === false;
  return <span className={unavailable ? styles.unavailableBadge : styles.choiceBadge}
    data-state={unavailable ? 'unavailable' : selected ? 'included' : 'available'}>
    {selectionLabel(entry, selected)}
  </span>;
}

function EntryIcon({ entry, size, render }: {
  readonly entry: McpStoreEntry;
  readonly size: number;
  readonly render?: McpStoreProps['renderIcon'];
}) {
  return <span className={styles.icon} style={{ width: size, height: size }}>
    {render?.(entry, size) ?? entry.name.slice(0, 1).toUpperCase()}
  </span>;
}

function ManageAction({ entry }: { readonly entry: McpStoreEntry }) {
  if (entry.status === 'connected' || entry.status === 'unavailable') {
    return <span className={`${styles.status} ${styles[entry.status]}`}>{statusLabel(entry.status)}</span>;
  }
  if (!entry.connectHref) {
    return <span className={styles.status}>{statusLabel(entry.status)}</span>;
  }
  return <a className={styles.action} href={entry.connectHref}>
    {entry.connectLabel ?? (entry.status === 'reconnect' ? 'Reconnect' : 'Connect')}
  </a>;
}

function PopularCard({ entry, mode, selected, onToggle, renderIcon }: {
  readonly entry: McpStoreEntry;
  readonly mode: 'manage' | 'select';
  readonly selected: boolean;
  readonly onToggle: () => void;
  readonly renderIcon?: McpStoreProps['renderIcon'];
}) {
  if (mode === 'select') return <button type="button" className={`${styles.popularCard} ${selected ? styles.selected : ''}`}
    disabled={entry.selectable === false} aria-pressed={selected} onClick={onToggle}>
    <EntryIcon entry={entry} size={38} render={renderIcon} /><strong>{entry.name}</strong>
    <SelectionStatus entry={entry} selected={selected} />
  </button>;
  return <article className={styles.popularCard}>
    <EntryIcon entry={entry} size={38} render={renderIcon} />
    {entry.detailHref ? <a className={styles.cardLink} href={entry.detailHref}>{entry.name}</a> : <strong>{entry.name}</strong>}
    <ManageAction entry={entry} />
  </article>;
}

function DirectoryRow({ entry, mode, selected, onToggle, renderIcon }: {
  readonly entry: McpStoreEntry;
  readonly mode: 'manage' | 'select';
  readonly selected: boolean;
  readonly onToggle: () => void;
  readonly renderIcon?: McpStoreProps['renderIcon'];
}) {
  const content = <><div className={styles.identity}><EntryIcon entry={entry} size={36} render={renderIcon} />
    <span><strong>{entry.name}</strong>{entry.accountName ? <small>{entry.accountName}</small> : null}
      {entry.readiness ? <em>{entry.readiness}</em> : null}</span></div>
    <span className={styles.type}>{entry.type}</span>
    <span className={styles.rowAction}>{mode === 'select'
      ? <SelectionStatus entry={entry} selected={selected} />
      : <ManageAction entry={entry} />}</span></>;
  if (mode === 'select') return <button type="button" className={`${styles.row} ${selected ? styles.selected : ''}`}
    disabled={entry.selectable === false} aria-pressed={selected} onClick={onToggle}>{content}</button>;
  return <article className={styles.row}>{content}
    {entry.detailHref ? <a className={styles.rowLink} href={entry.detailHref} aria-label={`View ${entry.name}`} /> : null}
  </article>;
}

export function McpStore({ entries, mode = 'manage', outcome, selectedIds = [],
  onSelectionChange, renderIcon }: McpStoreProps) {
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const selected = useMemo(() => new Set(selectedIds), [selectedIds]);
  const filtered = useMemo(() => entries.filter((entry) => {
    const connected = mode === 'select' ? selected.has(entry.id) : entry.status === 'connected';
    const statusMatches = filter === 'all' || (filter === 'connected' ? connected : !connected);
    const needle = query.trim().toLowerCase();
    return statusMatches && (!needle || `${entry.name} ${entry.description} ${entry.type}`.toLowerCase().includes(needle));
  }), [entries, filter, mode, query, selected]);
  const toggle = (entry: McpStoreEntry) => {
    if (entry.selectable === false) return;
    onSelectionChange?.(selected.has(entry.id)
      ? selectedIds.filter((id) => id !== entry.id) : [...new Set([...selectedIds, entry.id])]);
  };
  const labels = mode === 'select' ? ['All', 'Included', 'Not included'] : ['All', 'Connected', 'Not connected'];
  return <section className={`${styles.root} ${styles[mode]}`} aria-labelledby="mcp-store-heading">
    <header className={styles.hero}><div><h2 id="mcp-store-heading" tabIndex={-1}>Connectors</h2>
      <p>Connect once for the organization. Tokens rotate and read-only syncs resume automatically.</p></div>
      <label className={styles.search}><span>Search connectors</span><b aria-hidden="true">⌕</b>
        <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search" />
      </label></header>
    {outcome ? <p role="status" className={`${styles.outcome} ${styles[outcome]}`}>
      {outcome === 'connected' ? 'Connector authorized and verified.' : 'The connector could not be completed. Review its setup and try again.'}
    </p> : null}
    <div className={styles.popular}><h3>Popular</h3><div>{entries.filter((entry) => entry.popular).map((entry) =>
      <PopularCard key={entry.id} entry={entry} mode={mode} selected={selected.has(entry.id)}
        onToggle={() => toggle(entry)} renderIcon={renderIcon} />)}</div></div>
    <div className={styles.tabs} role="tablist" aria-label="Connector status">
      {(['all', 'connected', 'not_connected'] as const).map((value, index) => <button key={value} type="button"
        role="tab" aria-selected={filter === value} onClick={() => setFilter(value)}>{labels[index]}</button>)}
    </div>
    <div className={styles.directory} id="mcp-store-directory"><div className={styles.directoryHead}><span>Connector</span><span>Type</span><span>Status</span></div>
      {filtered.map((entry) => <DirectoryRow key={entry.id} entry={entry} mode={mode}
        selected={selected.has(entry.id)} onToggle={() => toggle(entry)} renderIcon={renderIcon} />)}
      {filtered.length === 0 ? <p className={styles.empty}>No connectors match this view.</p> : null}</div>
  </section>;
}
