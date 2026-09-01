'use client';

import { motion, useReducedMotion } from 'framer-motion';

import { displayPriceCents, type CatalogItemAssociations } from '@/lib/catalog-insights';
import type { ContentMenuItem } from '@/lib/content-model';

import { CatalogAssociationPanel } from './catalog-association-panel';
import { Icon } from './icon';
import { ManagedThumbnail } from './managed-thumbnail';
import { Button } from './ui/button';

type CatalogTableRowProps = {
  item: ContentMenuItem;
  category: string;
  associations: CatalogItemAssociations;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onEdit: () => void;
};

export function CatalogTableRow({ item, category, associations, open, onOpenChange, onEdit }: CatalogTableRowProps) {
  const reduceMotion = useReducedMotion();
  const detailId = `catalog-data-${item.id}`;
  const choiceCount = item.optionGroups.reduce((total, group) => total + group.choices.length, 0);
  const contentCount = item.mediaVersions.length + associations.resources.length + associations.training.length;
  return <>
    <tr className="catalog-table-row" data-expanded={open || undefined}>
      <td className="catalog-table-disclosure-cell">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-expanded={open}
          aria-controls={detailId}
          aria-label={`${open ? 'Hide' : 'Show'} associated data for ${item.name}`}
          onClick={() => onOpenChange(!open)}
        ><Icon name="chevron" className="catalog-disclosure-icon" /></Button>
      </td>
      <td>
        <button type="button" className="catalog-table-offering" onClick={onEdit}>
          <ManagedThumbnail url={item.imageUrl} alt={`${item.name} thumbnail`} />
          <span><strong>{item.name}</strong><small>{item.description || item.slug}</small></span>
        </button>
      </td>
      <td><strong className="catalog-cell-primary">{category}</strong><small className="catalog-cell-secondary">{item.audience}</small></td>
      <td><strong className="catalog-cell-price">{formatMoney(displayPriceCents(item))}</strong><small className="catalog-cell-secondary">{item.sizes.length > 0 ? countLabel(item.sizes.length, 'size') : 'base price'}</small></td>
      <td><StatusBadge item={item} /></td>
      <td><div className="catalog-content-counts" aria-label={`${countLabel(contentCount, 'linked content record')}`}>
        <span><b>{item.mediaVersions.length}</b> media</span>
        <span><b>{associations.resources.length}</b> resources</span>
        <span><b>{associations.training.length}</b> lessons</span>
      </div></td>
      <td><strong className="catalog-cell-primary">{countLabel(item.optionGroups.length, 'group')}</strong><small className="catalog-cell-secondary">{countLabel(choiceCount, 'choice')}</small></td>
      <td><Button type="button" variant="outline" size="sm" onClick={onEdit}>Edit</Button></td>
    </tr>
    {open ? <tr className="catalog-table-detail-row">
      <td colSpan={8} id={detailId}>
        <motion.div
          initial={reduceMotion ? false : { opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: reduceMotion ? 0 : .18, ease: [0.16, 1, 0.3, 1] }}
        ><CatalogAssociationPanel item={item} associations={associations} /></motion.div>
      </td>
    </tr> : null}
  </>;
}

function StatusBadge({ item }: { item: ContentMenuItem }) {
  const label = item.is86d ? '86’d' : item.isListed ? 'Published' : 'Unlisted';
  return <span className={`catalog-status-badge is-${item.is86d ? 'paused' : item.isListed ? 'live' : 'draft'}`}><i />{label}</span>;
}

function formatMoney(cents: number): string {
  return (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

function countLabel(count: number, singular: string): string {
  return `${count} ${singular}${count === 1 ? '' : 's'}`;
}
