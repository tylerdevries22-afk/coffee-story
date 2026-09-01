'use client';

import type {
  ContentCatalogPlacement, ContentCatalogRelation, ContentCatalogResource,
  ContentCategory, ContentMenuItem, MenuItemDraft,
} from '@/lib/content-model';

import { CatalogMenuItemForm } from './catalog-menu-item-form';
import { CatalogRelationships } from './catalog-relationships';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from './ui/sheet';

type CatalogEditorSheetProps = {
  selected: ContentMenuItem | MenuItemDraft | null;
  categories: ContentCategory[];
  resources: ContentCatalogResource[];
  relations: ContentCatalogRelation[];
  placements: ContentCatalogPlacement[];
  pending: boolean;
  onClose: () => void;
  onCategories: React.Dispatch<React.SetStateAction<ContentCategory[]>>;
  onResources: React.Dispatch<React.SetStateAction<ContentCatalogResource[]>>;
  onRelations: React.Dispatch<React.SetStateAction<ContentCatalogRelation[]>>;
  onPlacements: React.Dispatch<React.SetStateAction<ContentCatalogPlacement[]>>;
  onSave: (draft: MenuItemDraft, expectedUpdatedAt: string | null) => void;
  onArchive: (id: string) => void;
};

export function CatalogEditorSheet(props: CatalogEditorSheetProps) {
  const { selected } = props;
  return <Sheet open={Boolean(selected)} onOpenChange={(open) => { if (!open) props.onClose(); }}>
    <SheetContent className="catalog-editor-sheet">
      <SheetHeader className="catalog-editor-sheet-header">
        <SheetTitle>{selected?.id ? `Edit ${selected.name}` : 'Add offering'}</SheetTitle>
        <SheetDescription>Update the offering and its reusable content relationships. Changes remain scoped to this catalog.</SheetDescription>
      </SheetHeader>
      {selected ? <div className="catalog-editor-sheet-body">
        <CatalogMenuItemForm
          key={selected.id ?? 'new'}
          initial={selected}
          categories={props.categories}
          pending={props.pending}
          onAddCategory={(category) => props.onCategories((current) => [...current, category])}
          onUpdateCategory={(category) => props.onCategories((current) => current.map((candidate) => candidate.id === category.id ? category : candidate))}
          onSave={props.onSave}
        />
        {selected.id ? <CatalogRelationships
          nodeId={selected.id}
          categories={props.categories}
          resources={props.resources}
          relations={props.relations}
          placements={props.placements}
          onResource={(resource) => props.onResources((current) => [...current, resource])}
          onResourceUpdate={(resource) => props.onResources((current) => current.map((candidate) => candidate.id === resource.id ? resource : candidate))}
          onRelation={(relation) => props.onRelations((current) => [...current, relation])}
          onPlacement={(placement) => props.onPlacements((current) => [...current, placement])}
          onArchive={() => props.onArchive(selected.id ?? '')}
        /> : null}
      </div> : null}
    </SheetContent>
  </Sheet>;
}
