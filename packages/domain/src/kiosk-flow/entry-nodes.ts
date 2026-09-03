/**
 * Parsing the entry tiles a tenant drew by hand.
 *
 * Every target is checked against the menu when the menu is known and kept when
 * it is not, so a caller who has not loaded the rows can never blank the first
 * screen -- unverifiable is not the same as invalid.
 */

import { EMPHASES, MAX_ENTRY_NODES, MAX_LABEL, MAX_PROMPT, UTILITIES } from './limits';
import { asRecord, note, oneOf, text } from './primitives';

import type { KioskEntryNode, KioskFlowNote, KioskMenuFacts, KioskNodeTarget } from './types';

/** The tiles a tenant configured, after every unusable one is dropped. */
export function readNodes(
  entry: unknown,
  menu: KioskMenuFacts,
  notes: KioskFlowNote[] | null,
): readonly KioskEntryNode[] {
  const raw = asRecord(entry)?.nodes;
  if (!Array.isArray(raw)) return [];
  return parseNodeList(raw, 0, menu, notes, 'kiosk.entry.nodes');
}

function parseNodeList(
  raw: readonly unknown[],
  depth: number,
  menu: KioskMenuFacts,
  notes: KioskFlowNote[] | null,
  path: string,
): KioskEntryNode[] {
  const nodes: KioskEntryNode[] = [];
  const seen = new Set<string>();
  for (const [index, candidate] of raw.entries()) {
    if (nodes.length >= MAX_ENTRY_NODES) {
      note(notes, path, `Only the first ${MAX_ENTRY_NODES} tiles are shown.`);
      break;
    }
    const node = parseNode(candidate, depth, menu, notes, `${path}[${index}]`);
    if (!node) continue;
    // First id wins. A duplicate is a copy-paste in the editor, and silently
    // rendering two tiles that route to the same place is worse than one.
    if (seen.has(node.id)) {
      note(notes, `${path}[${index}].id`, `Another tile already uses the id "${node.id}".`);
      continue;
    }
    seen.add(node.id);
    nodes.push(node);
  }
  return nodes;
}

function parseNode(
  value: unknown,
  depth: number,
  menu: KioskMenuFacts,
  notes: KioskFlowNote[] | null,
  path: string,
): KioskEntryNode | null {
  const source = asRecord(value);
  if (!source) {
    note(notes, path, 'Not a tile.');
    return null;
  }
  const id = text(source.id, MAX_LABEL);
  const label = text(source.label, MAX_LABEL);
  if (!id || !label) {
    note(notes, path, 'A tile needs an id and a label.');
    return null;
  }
  const target = parseTarget(source.target, depth, menu, notes, `${path}.target`);
  if (!target) return null;
  const imageSlug = text(source.imageSlug, MAX_LABEL);
  const caption = text(source.caption, MAX_PROMPT);
  return {
    id,
    label,
    emphasis: oneOf(source.emphasis, EMPHASES, 'standard'),
    target,
    ...(imageSlug ? { imageSlug } : {}),
    ...(caption ? { caption } : {}),
  };
}

function parseTarget(
  value: unknown,
  depth: number,
  menu: KioskMenuFacts,
  notes: KioskFlowNote[] | null,
  path: string,
): KioskNodeTarget | null {
  const source = asRecord(value);
  if (!source) {
    note(notes, path, 'A tile needs to point somewhere.');
    return null;
  }
  switch (source.kind) {
    case 'category': {
      const categoryId = text(source.categoryId, MAX_LABEL);
      if (!categoryId) return null;
      // Only checkable when the menu is known. A caller who has not loaded it
      // gets the tile kept, never a blanked screen.
      const matched = menu.categories.find((category) => category.id === categoryId || category.aliases?.includes(categoryId));
      if (menu.categories.length > 0 && !matched) {
        note(notes, path, `No category "${categoryId}" on this menu; the tile would be a dead button.`);
        return null;
      }
      return { kind: 'category', categoryId: matched?.id ?? categoryId };
    }
    case 'item': {
      const itemSlug = text(source.itemSlug, MAX_LABEL);
      if (!itemSlug) return null;
      if (menu.itemSlugs.length > 0 && !menu.itemSlugs.includes(itemSlug)) {
        note(notes, path, `No item "${itemSlug}" on this menu; the tile would be a dead button.`);
        return null;
      }
      return { kind: 'item', itemSlug };
    }
    case 'utility': {
      const utility = oneOf(source.utility, UTILITIES, null);
      return utility ? { kind: 'utility', utility } : null;
    }
    case 'group': {
      if (depth >= 5) {
        note(notes, path, 'Catalog folders can nest up to five levels.');
        return null;
      }
      if (!Array.isArray(source.nodes)) return null;
      const nodes = parseNodeList(source.nodes, depth + 1, menu, notes, `${path}.nodes`);
      return nodes.length > 0 ? { kind: 'group', nodes } : null;
    }
    default:
      note(notes, path, 'Unknown tile kind.');
      return null;
  }
}
