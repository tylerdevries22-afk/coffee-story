'use client';

import { useDeferredValue, useMemo, useState } from 'react';

import {
  buildCatalogAssociationIndex, catalogPath, displayPriceCents, EMPTY_CATALOG_ASSOCIATIONS,
} from '@/lib/catalog-insights';
import type {
  ContentCatalogPlacement, ContentCatalogRelation, ContentCatalogResource,
  ContentCategory, ContentMenuItem, ContentWorkspaceData,
} from '@/lib/content-model';

import { CatalogTableRow } from './catalog-table-row';
import { Icon } from './icon';
import { Button } from './ui/button';

type CatalogDataTableProps = {
  categories: ContentCategory[];
  items: ContentMenuItem[];
  resources: ContentCatalogResource[];
  relations: ContentCatalogRelation[];
  placements: ContentCatalogPlacement[];
  training: ContentWorkspaceData['training']['manifest'];
  expandedItems: Set<string>;
  onToggleItem: (id: string, open: boolean) => void;
  onExpandItems: (ids: Set<string>) => void;
  onEditItem: (id: string) => void;
};

type StatusFilter = 'all' | 'published' | 'unlisted' | '86d';
type SortKey = 'name' | 'category' | 'price' | 'content';

export function CatalogDataTable(props: CatalogDataTableProps) {
  const [query, setQuery] = useState('');
  const [categoryId, setCategoryId] = useState('all');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [sortKey, setSortKey] = useState<SortKey>('name');
  const deferredQuery = useDeferredValue(query.trim().toLowerCase());
  const associationIndex = useMemo(() => buildCatalogAssociationIndex(
    props.items, props.categories, props.resources, props.relations, props.placements, props.training,
  ), [props.items, props.categories, props.resources, props.relations, props.placements, props.training]);
  const rows = useMemo(() => props.items.filter((item) => {
    const category = catalogPath(props.categories, item.categoryId);
    const matchesQuery = !deferredQuery || `${item.name} ${item.description} ${item.slug} ${category}`.toLowerCase().includes(deferredQuery);
    const matchesCategory = categoryId === 'all' || item.categoryId === categoryId;
    const matchesStatus = status === 'all'
      || (status === 'published' && item.isListed && !item.is86d)
      || (status === 'unlisted' && !item.isListed)
      || (status === '86d' && item.is86d);
    return matchesQuery && matchesCategory && matchesStatus;
  }).sort((left, right) => compareRows(left, right, sortKey, props.categories, associationIndex)), [
    props.items, props.categories, deferredQuery, categoryId, status, sortKey, associationIndex,
  ]);
  const allVisibleOpen = rows.length > 0 && rows.every((item) => props.expandedItems.has(item.id));
  return <div className="catalog-data-table">
    <div className="catalog-table-toolbar">
      <label className="catalog-table-search"><span className="sr-only">Search catalog</span><Icon name="search" /><input type="search" placeholder="Search offerings, folders, or slugs" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
      <label><span>Folder</span><select value={categoryId} onChange={(event) => setCategoryId(event.target.value)}><option value="all">All folders</option>{props.categories.map((category) => <option key={category.id} value={category.id}>{catalogPath(props.categories, category.id)}</option>)}</select></label>
      <label><span>Status</span><select value={status} onChange={(event) => setStatus(event.target.value as StatusFilter)}><option value="all">All statuses</option><option value="published">Published</option><option value="unlisted">Unlisted</option><option value="86d">86’d</option></select></label>
      <label><span>Sort</span><select value={sortKey} onChange={(event) => setSortKey(event.target.value as SortKey)}><option value="name">Name</option><option value="category">Folder</option><option value="price">Price</option><option value="content">Content coverage</option></select></label>
      <Button type="button" variant="outline" onClick={() => props.onExpandItems(allVisibleOpen ? new Set() : new Set(rows.map((item) => item.id)))}>{allVisibleOpen ? 'Collapse all' : 'Expand all'}</Button>
    </div>
    <div className="catalog-table-meta"><span role="status">{rows.length} of {props.items.length} offerings</span><span>Click an offering to edit · expand a row to inspect all linked data</span></div>
    <div className="catalog-table-scroll">
      <table className="catalog-table">
        <thead><tr><th aria-label="Details" /><th>Offering</th><th>Folder</th><th>Price</th><th>Status</th><th>Linked content</th><th>Ordering</th><th>Actions</th></tr></thead>
        <tbody>{rows.map((item) => <CatalogTableRow
          key={item.id}
          item={item}
          category={catalogPath(props.categories, item.categoryId)}
          associations={associationIndex.get(item.id) ?? EMPTY_CATALOG_ASSOCIATIONS}
          open={props.expandedItems.has(item.id)}
          onOpenChange={(open) => props.onToggleItem(item.id, open)}
          onEdit={() => props.onEditItem(item.id)}
        />)}</tbody>
      </table>
      {rows.length === 0 ? <div className="catalog-table-empty"><Icon name="search" /><strong>No matching offerings</strong><span>Adjust the search, folder, or status filters.</span></div> : null}
    </div>
  </div>;
}

function compareRows(
  left: ContentMenuItem,
  right: ContentMenuItem,
  key: SortKey,
  categories: ContentCategory[],
  associations: ReturnType<typeof buildCatalogAssociationIndex>,
): number {
  if (key === 'price') return displayPriceCents(left) - displayPriceCents(right);
  if (key === 'category') return catalogPath(categories, left.categoryId).localeCompare(catalogPath(categories, right.categoryId)) || left.name.localeCompare(right.name);
  if (key === 'content') {
    const count = (item: ContentMenuItem) => item.mediaVersions.length + (associations.get(item.id)?.resources.length ?? 0) + (associations.get(item.id)?.training.length ?? 0);
    return count(right) - count(left) || left.name.localeCompare(right.name);
  }
  return left.name.localeCompare(right.name);
}
