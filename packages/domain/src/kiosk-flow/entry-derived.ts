/**
 * The first screen when the tenant has not drawn one, and the merge that lets a
 * catalog tenant restyle a derived tile without freezing the list.
 *
 * Derived rather than stored, because a stored list stops following the menu
 * the moment a category is added, renamed or retired.
 */

import { MAX_ENTRY_NODES, MAX_LABEL } from './limits';
import { text } from './primitives';

import type { KioskEntryNode, KioskMenuFacts } from './types';

export function catalogPresentation(
  derived: readonly KioskEntryNode[],
  configured: readonly KioskEntryNode[],
): KioskEntryNode[] {
  const overrides = new Map<string, KioskEntryNode>();
  const collect = (nodes: readonly KioskEntryNode[]) => {
    for (const node of nodes) {
      const key = node.target.kind === 'category' ? node.target.categoryId : node.id;
      overrides.set(key, node);
      if (node.target.kind === 'group') collect(node.target.nodes);
    }
  };
  collect(configured);
  return derived.map((node) => {
    const key = node.target.kind === 'category' ? node.target.categoryId : node.id;
    const override = overrides.get(key);
    const target = node.target.kind === 'group'
      ? { kind: 'group' as const, nodes: catalogPresentation(node.target.nodes, configured) }
      : node.target;
    return {
      ...node, target,
      ...(override ? {
        label: override.label, emphasis: override.emphasis,
        ...(override.imageSlug ? { imageSlug: override.imageSlug } : {}),
        ...(override.caption ? { caption: override.caption } : {}),
      } : {}),
    };
  });
}

/**
 * The zero-config first screen: the tenant's own menu categories, the first one
 * given the hero slot because a constellation with no anchor reads as a grid.
 */
export function entryNodesFromCategories(
  categories: KioskMenuFacts['categories'],
): KioskEntryNode[] {
  const ids = new Set(categories.map((category) => category.id));
  const roots = categories.filter((category) => !category.parentId || !ids.has(category.parentId));
  return folderNodes(roots, categories, 0);
}

function folderNodes(
  siblings: KioskMenuFacts['categories'],
  categories: KioskMenuFacts['categories'],
  depth: number,
): KioskEntryNode[] {
  const nodes: KioskEntryNode[] = [];
  for (const category of siblings) {
    if (nodes.length >= MAX_ENTRY_NODES) break;
    const id = text(category?.id, MAX_LABEL);
    const label = text(category?.title, MAX_LABEL);
    if (!id || !label) continue;
    const children = depth < 4 ? categories.filter((candidate) => candidate.parentId === id) : [];
    const nested = children.length > 0 ? folderNodes(children, categories, depth + 1) : [];
    if (category.hasItems && nested.length > 0) nested.unshift({
      id: `${id}-all`, label: `All ${label}`, emphasis: 'standard',
      target: { kind: 'category', categoryId: id },
    });
    nodes.push({
      id,
      label,
      emphasis: nodes.length === 0 ? 'hero' : 'standard',
      target: nested.length > 0 ? { kind: 'group', nodes: nested } : { kind: 'category', categoryId: id },
    });
  }
  return nodes;
}
