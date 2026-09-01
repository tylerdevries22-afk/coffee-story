'use client';

import { CatalogDataTable } from './catalog-data-table';
import { CatalogEditorSheet } from './catalog-editor-sheet';
import { Icon } from './icon';
import { Button } from './ui/button';
import { type MenuContentEditorProps, useCatalogEditor } from './use-catalog-editor';

export function MenuContentEditor(props: MenuContentEditorProps) {
  const editor = useCatalogEditor(props);
  return <section className="catalog-table-card" aria-label="Catalog records">
    <header className="catalog-table-card-header">
      <div>
        <span className="eyebrow">Catalog records</span>
        <h2>{editor.items.length} offerings across {editor.categories.length} folders</h2>
      </div>
      <div className="catalog-table-actions">
        <span className={`catalog-readiness ${editor.validation.errors.length > 0 ? 'has-errors' : ''}`}>{editor.validation.errors.length} errors · {editor.validation.warnings.length} warnings</span>
        <Button type="button" variant="outline" onClick={editor.createItem}><Icon name="plus" />Add offering</Button>
        <Button type="button" disabled={editor.pending || editor.validation.errors.length > 0} onClick={editor.publish}>Publish changes</Button>
      </div>
    </header>
    {editor.validation.errors.length > 0 ? <details className="catalog-table-validation">
      <summary>Resolve release blockers</summary>
      {editor.validation.errors.map((issue) => <p key={issue}>{issue}</p>)}
    </details> : null}
    <CatalogDataTable
      categories={editor.categories}
      items={editor.items}
      resources={editor.resources}
      relations={editor.relations}
      placements={editor.placements}
      training={props.training}
      expandedItems={editor.expandedItems}
      onToggleItem={editor.toggleItem}
      onExpandItems={editor.setExpandedItems}
      onEditItem={editor.editItem}
    />
    <CatalogEditorSheet
      selected={editor.selected}
      categories={editor.categories}
      resources={editor.resources}
      relations={editor.relations}
      placements={editor.placements}
      pending={editor.pending}
      onClose={editor.closeEditor}
      onCategories={editor.setCategories}
      onResources={editor.setResources}
      onRelations={editor.setRelations}
      onPlacements={editor.setPlacements}
      onSave={editor.save}
      onArchive={(id) => void editor.archive(id)}
    />
    {editor.message ? <p className="content-message catalog-table-message" role="status">{editor.message}</p> : null}
  </section>;
}
