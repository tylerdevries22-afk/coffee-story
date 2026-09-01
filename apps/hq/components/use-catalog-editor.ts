'use client';

import { useMemo, useState, useTransition } from 'react';

import { archiveCatalogNode, saveMenuItem, setMenuPublished } from '@/app/(console)/content/actions';
import { catalogValidationSummary } from '@/lib/catalog-insights';
import type {
  ContentCatalogPlacement, ContentCatalogRelation, ContentCatalogResource,
  ContentCategory, ContentMenu, ContentMenuItem, ContentWorkspaceData, MenuItemDraft,
} from '@/lib/content-model';

export type MenuContentEditorProps = {
  initialMenu: ContentMenu;
  initialCategories: ContentCategory[];
  initialItems: ContentMenuItem[];
  initialResources: ContentCatalogResource[];
  initialRelations: ContentCatalogRelation[];
  initialPlacements: ContentCatalogPlacement[];
  training: ContentWorkspaceData['training']['manifest'];
};

export function useCatalogEditor(props: MenuContentEditorProps) {
  const [menu, setMenu] = useState(props.initialMenu);
  const [categories, setCategories] = useState(props.initialCategories);
  const [items, setItems] = useState(props.initialItems);
  const [resources, setResources] = useState(props.initialResources);
  const [relations, setRelations] = useState(props.initialRelations);
  const [placements, setPlacements] = useState(props.initialPlacements);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [newDraft, setNewDraft] = useState<MenuItemDraft | null>(null);
  const [expandedItems, setExpandedItems] = useState(() => new Set<string>());
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const selected = newDraft ?? items.find((item) => item.id === selectedId) ?? null;
  const validation = useMemo(
    () => catalogValidationSummary(categories, items, resources, relations),
    [categories, items, resources, relations],
  );

  function createItem() {
    setNewDraft({
      id: null, name: 'New offering', slug: 'new-offering', description: '',
      categoryId: categories[0]?.id ?? '', basePriceCents: 0, imageUrl: null,
      audience: 'public', sizes: [], optionGroups: [], isListed: false, is86d: false,
      sortOrder: items.length * 10 + 10,
    });
    setSelectedId(null);
    setMessage(null);
  }

  function editItem(id: string) {
    setNewDraft(null);
    setSelectedId(id);
    setMessage(null);
  }

  function closeEditor() {
    setNewDraft(null);
    setSelectedId(null);
  }

  function toggleItem(id: string, open: boolean) {
    setExpandedItems((current) => {
      const next = new Set(current);
      if (open) next.add(id); else next.delete(id);
      return next;
    });
  }

  function saved(item: ContentMenuItem, persisted: boolean) {
    setItems((current) => {
      const existing = current.find((candidate) => candidate.id === item.id);
      const next = !persisted && item.mediaVersions.length === 0 && existing
        ? { ...item, mediaVersions: existing.mediaVersions }
        : item;
      return existing ? current.map((candidate) => candidate.id === item.id ? next : candidate) : [...current, next];
    });
    setNewDraft(null);
    setSelectedId(item.id);
    setExpandedItems((current) => new Set(current).add(item.id));
    setMessage(persisted ? 'Offering saved.' : 'Preview updated. Connect Supabase to persist changes.');
  }

  function save(draft: MenuItemDraft, expectedUpdatedAt: string | null) {
    startTransition(async () => {
      setMessage(null);
      const result = await saveMenuItem(draft, expectedUpdatedAt);
      if (result.ok) saved(result.item, result.persisted); else setMessage(result.error);
    });
  }

  function publish() {
    startTransition(async () => {
      const result = await setMenuPublished(menu.id, true, menu.updatedAt);
      if (!result.ok) return setMessage(result.error);
      setMenu((current) => ({
        ...current, isPublished: true, publishedVersion: result.publishedVersion,
        draftVersion: current.draftVersion + 1, updatedAt: result.updatedAt,
      }));
      setMessage(result.persisted ? `Release v${result.publishedVersion} is live.` : 'Preview publication state updated.');
    });
  }

  async function archive(id: string) {
    const result = await archiveCatalogNode('offering', id);
    if (!result.ok) return setMessage(result.error);
    setItems((current) => current.filter((item) => item.id !== id));
    setExpandedItems((current) => { const next = new Set(current); next.delete(id); return next; });
    closeEditor();
    setMessage('Offering archived. Its stable ID and order history are preserved.');
  }

  return {
    menu, categories, items, resources, relations, placements, selected, expandedItems,
    message, pending, validation, setCategories, setItems, setResources, setRelations,
    setPlacements, setExpandedItems, createItem, editItem, closeEditor, toggleItem,
    save, publish, archive,
  };
}
