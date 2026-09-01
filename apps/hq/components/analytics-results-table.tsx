'use client';

import { motion, useReducedMotion } from 'framer-motion';
import { useMemo, useState } from 'react';

import type { AnalyticsTable } from '@/lib/analytics-dashboard';

import { Icon } from './icon';

type AnalyticsResultsTableProps = { tables: readonly AnalyticsTable[] };

function rowKey(row: readonly string[], index: number): string {
  return `${row[0] ?? 'row'}-${index}`;
}

export function AnalyticsResultsTable({ tables }: AnalyticsResultsTableProps) {
  const reduceMotion = useReducedMotion();
  const [tableIndex, setTableIndex] = useState(0);
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const table = tables[tableIndex] ?? tables[0];
  const rows = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return (table?.rows ?? []).map((row, index) => ({ row, key: rowKey(row, index) }))
      .filter(({ row }) => !normalized || row.some((cell) => cell.toLocaleLowerCase().includes(normalized)));
  }, [query, table]);
  const allExpanded = rows.length > 0 && rows.every(({ key }) => expanded.has(key));
  if (!table) return null;

  const selectTable = (index: number) => {
    setTableIndex(index);
    setQuery('');
    setExpanded(new Set());
  };
  const toggleAll = () => setExpanded(allExpanded ? new Set() : new Set(rows.map(({ key }) => key)));
  const toggleRow = (key: string) => setExpanded((current) => {
    const next = new Set(current);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  return (
    <section className="analytics-card analytics-results-panel" aria-labelledby="analytics-results-title">
      <div className="analytics-results-heading">
        <div><h2 id="analytics-results-title">Results</h2><p>{table.description}</p></div>
        <button type="button" className="analytics-expand-all" role="switch" aria-checked={allExpanded} onClick={toggleAll} disabled={rows.length === 0}>Expand all <i aria-hidden="true"><span /></i></button>
      </div>
      <div className="analytics-results-toolbar">
        <div className="analytics-table-tabs" role="tablist" aria-label="Result datasets">
          {tables.map((item, index) => <button key={item.title} id={`analytics-table-tab-${index}`} type="button" role="tab" aria-controls="analytics-table-panel" aria-selected={index === tableIndex} onClick={() => selectTable(index)}>{item.title} <span>{item.rows.length}</span></button>)}
        </div>
        <label className="analytics-table-search"><span className="sr-only">Search {table.title}</span><Icon name="search" size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} type="search" placeholder="Search results…" /></label>
      </div>
      {rows.length === 0 ? <div id="analytics-table-panel" role="tabpanel" aria-labelledby={`analytics-table-tab-${tableIndex}`} className="analytics-results-empty"><Icon name="search" /><strong>{query ? 'No matching results' : 'Collecting the first complete window'}</strong><p>{query ? 'Try a broader search.' : table.emptyMessage}</p></div> : <div id="analytics-table-panel" role="tabpanel" aria-labelledby={`analytics-table-tab-${tableIndex}`} className="analytics-results-scroll" tabIndex={0}>
        <table>
          <thead><tr><th aria-label="Expand row" />{table.columns.map((column) => <th key={column} scope="col">{column} <span aria-hidden="true">↕</span></th>)}</tr></thead>
          <tbody>{rows.map(({ row, key }) => {
            const isOpen = expanded.has(key);
            const detailId = `analytics-row-${key.replaceAll(' ', '-').toLocaleLowerCase()}`;
            return [
              <tr key={key} className="analytics-result-row" data-expanded={isOpen || undefined}>
                <td><button type="button" className="analytics-row-toggle" aria-expanded={isOpen} aria-controls={detailId} aria-label={`${isOpen ? 'Hide' : 'Show'} details for ${row[0]}`} onClick={() => toggleRow(key)}><Icon name="chevron" size={16} /></button></td>
                {row.map((cell, cellIndex) => cellIndex === 0 ? <th key={`${key}-${cellIndex}`} scope="row">{cell}</th> : <td key={`${key}-${cellIndex}`}>{cell}</td>)}
              </tr>,
              isOpen ? <tr key={`${key}-detail`} className="analytics-result-detail"><td colSpan={table.columns.length + 1} id={detailId}><motion.div initial={reduceMotion ? false : { opacity: 0, y: -5 }} animate={{ opacity: 1, y: 0 }}><p>{table.description}</p><dl>{table.columns.map((column, index) => <div key={column}><dt>{column}</dt><dd>{row[index] ?? '—'}</dd></div>)}</dl></motion.div></td></tr> : null,
            ];
          })}</tbody>
        </table>
      </div>}
    </section>
  );
}
