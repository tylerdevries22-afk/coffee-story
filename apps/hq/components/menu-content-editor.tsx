'use client';

import { useEffect, useMemo, useRef, useState, useTransition, type CSSProperties } from 'react';

import {
  addCatalogAlias,
  addMenuCategory,
  addCatalogResource,
  archiveCatalogNode,
  linkCatalogResource,
  moveCatalogNode,
  saveMenuItem,
  saveMenuCategory,
  saveCatalogResourceImage,
  setMenuPublished,
  uploadContentImage,
} from '@/app/(console)/content/actions';
import {
  slugFromLabel,
  type ContentCategory,
  type ContentCatalogRelation,
  type ContentCatalogPlacement,
  type ContentCatalogResource,
  type ContentMenu,
  type ContentMenuItem,
  type MenuItemDraft,
} from '@/lib/content-model';

import { ContentIcon } from './content-workspace';
import { ManagedThumbnail } from './managed-thumbnail';
import { MenuOrderingEditor } from './menu-ordering-editor';

export function MenuContentEditor({
  initialMenu,
  initialCategories,
  initialItems,
  initialResources,
  initialRelations,
  initialPlacements,
}: {
  initialMenu: ContentMenu;
  initialCategories: ContentCategory[];
  initialItems: ContentMenuItem[];
  initialResources: ContentCatalogResource[];
  initialRelations: ContentCatalogRelation[];
  initialPlacements: ContentCatalogPlacement[];
}) {
  const [menu, setMenu] = useState(initialMenu);
  const [categories, setCategories] = useState(initialCategories);
  const [items, setItems] = useState(initialItems);
  const [resources, setResources] = useState(initialResources);
  const [relations, setRelations] = useState(initialRelations);
  const [placements, setPlacements] = useState(initialPlacements);
  const [selectedId, setSelectedId] = useState<string | null>(initialItems[0]?.id ?? null);
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(() => new Set(initialCategories.map((category) => category.id)));
  const [folderName, setFolderName] = useState('');
  const [newDraft, setNewDraft] = useState<MenuItemDraft | null>(null);
  const [query, setQuery] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const selected = newDraft ?? items.find((item) => item.id === selectedId) ?? null;
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return needle ? items.filter((item) => item.name.toLowerCase().includes(needle)) : items;
  }, [items, query]);
  const validation = useMemo(() => catalogValidationSummary(categories, items, resources, relations), [categories, items, resources, relations]);

  function createItem() {
    setNewDraft({
      id: null, name: 'New item', slug: 'new-item', description: '',
      categoryId: categories[0]?.id ?? '', basePriceCents: 0, imageUrl: null,
      audience: 'public',
      sizes: [], optionGroups: [],
      isListed: false, is86d: false, sortOrder: items.length * 10 + 10,
    });
    setSelectedId(null);
    setMessage(null);
  }

  function selectItem(id: string) {
    setNewDraft(null);
    setSelectedId(id);
    setSelectedFolderId(null);
    setMessage(null);
  }

  function selectFolder(id: string) {
    setNewDraft(null);
    setSelectedId(null);
    setSelectedFolderId(id);
    setMessage(null);
  }

  function toggleFolder(id: string) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function createFolder() {
    const result = await addMenuCategory(folderName, '', selectedFolderId);
    if (!result.ok) return setMessage(result.error);
    setCategories((current) => [...current, result.category]);
    setExpanded((current) => new Set(current).add(result.category.id));
    setFolderName('');
    selectFolder(result.category.id);
    setMessage(result.persisted ? 'Folder created in the catalog draft.' : 'Preview folder created.');
  }

  async function moveNode(kind: 'folder' | 'offering', nodeId: string, parentId: string) {
    const result = await moveCatalogNode(kind, nodeId, parentId);
    if (!result.ok) return setMessage(result.error);
    if (kind === 'folder') setCategories((current) => current.map((folder) => folder.id === nodeId ? { ...folder, parentId } : folder));
    else setItems((current) => current.map((item) => item.id === nodeId ? { ...item, categoryId: parentId } : item));
    setExpanded((current) => new Set(current).add(parentId));
    setMessage('Catalog hierarchy updated. Publish when the draft is ready.');
  }

  function saved(item: ContentMenuItem, persisted: boolean) {
    setItems((current) => {
      const existing = current.find((candidate) => candidate.id === item.id);
      const savedItem = !persisted && item.mediaVersions.length === 0 && existing
        ? { ...item, mediaVersions: existing.mediaVersions }
        : item;
      return existing
        ? current.map((candidate) => candidate.id === item.id ? savedItem : candidate)
        : [...current, savedItem];
    });
    setNewDraft(null);
    setSelectedId(item.id);
    setMessage(persisted ? 'Offering saved to the catalog draft.' : 'Preview updated. Connect Supabase to persist changes.');
  }

  return (
    <div className="content-editor-grid">
      <aside className="content-rail catalog-tree-rail" aria-label="Catalog hierarchy">
        <div className="content-rail-header">
          <div><strong>{menu.name.replace(/menu/gi, 'catalog')}</strong><span>{categories.length} folders · {items.length} offerings</span></div>
          <span className="pill success">v{menu.publishedVersion ?? '—'}</span>
        </div>
        <label className="content-search">
          <span className="sr-only">Search catalog</span>
          <input type="search" placeholder="Search folders and offerings" value={query} onChange={(event) => setQuery(event.target.value)} />
        </label>
        <div className="content-rail-list catalog-tree" role="tree">
          {query.trim() ? filtered.map((item) => (
            <button type="button" key={item.id} className={selectedId === item.id && !newDraft ? 'active' : ''} onClick={() => selectItem(item.id)}>
              <MenuThumb item={item} />
              <span><strong>{item.name}</strong><small>{catalogPath(categories, item.categoryId)} · ${(displayPriceCents(item) / 100).toFixed(2)}</small></span>
              {!item.isListed || item.is86d ? <i aria-label={item.is86d ? '86’d' : 'Unlisted'} /> : null}
            </button>
          )) : (
            <CatalogTree
              categories={categories}
              items={items}
              expanded={expanded}
              selectedFolderId={selectedFolderId}
              selectedItemId={selectedId}
              onToggle={toggleFolder}
              onSelectFolder={selectFolder}
              onSelectItem={selectItem}
              onMove={(kind, nodeId, parentId) => void moveNode(kind, nodeId, parentId)}
            />
          )}
        </div>
        <div className="catalog-tree-actions">
          <div className="catalog-folder-create">
            <input aria-label="New folder name" placeholder={selectedFolderId ? 'New nested folder' : 'New root folder'} value={folderName} onChange={(event) => setFolderName(event.target.value)} />
            <button type="button" disabled={folderName.trim().length < 2} onClick={() => void createFolder()}><ContentIcon kind="plus" /><span className="sr-only">Add folder</span></button>
          </div>
          <button type="button" className="content-add-button" onClick={createItem}><ContentIcon kind="plus" /> Add offering</button>
        </div>
      </aside>

      <div className="content-editor-panel">
        <div className="content-panel-toolbar">
          <div><p className="eyebrow">Catalog draft · v{menu.draftVersion}</p><h2>{selected?.name ?? categories.find((folder) => folder.id === selectedFolderId)?.title ?? 'Choose an offering or folder'}</h2></div>
          <button
            type="button"
            className="button secondary content-square-button"
            disabled={pending || validation.errors.length > 0}
            onClick={() => startTransition(async () => {
              const result = await setMenuPublished(menu.id, true, menu.updatedAt);
              if (result.ok) {
                setMenu((current) => ({ ...current, isPublished: true, publishedVersion: result.publishedVersion, draftVersion: current.draftVersion + 1, updatedAt: result.updatedAt }));
                setMessage(result.persisted ? `Catalog release v${result.publishedVersion} is live on every app.` : 'Preview publication state updated.');
              } else setMessage(result.error);
            })}
          >
            Publish catalog
          </button>
        </div>
        <details className={`catalog-validation ${validation.errors.length > 0 ? 'has-errors' : ''}`} open={validation.errors.length > 0}>
          <summary><span>Draft validation</span><span className="pill">{validation.errors.length} errors · {validation.warnings.length} warnings</span></summary>
          {validation.errors.length === 0 && validation.warnings.length === 0 ? <p>Hierarchy, relationships, and media are ready to publish.</p> : null}
          {[...validation.errors, ...validation.warnings].slice(0, 12).map((issue) => <p key={issue}>{issue}</p>)}
        </details>
        {selected ? (
          <>
            <MenuItemForm
              key={selected.id ?? 'new'}
              initial={selected}
              categories={categories}
              pending={pending}
              onAddCategory={(category) => setCategories((current) => [...current, category])}
              onUpdateCategory={(category) => setCategories((current) => current.map((candidate) => candidate.id === category.id ? category : candidate))}
              onSave={(draft, expectedUpdatedAt) => startTransition(async () => {
                setMessage(null);
                const result = await saveMenuItem(draft, expectedUpdatedAt);
                if (result.ok) saved(result.item, result.persisted);
                else setMessage(result.error);
              })}
            />
            {selected.id ? <CatalogRelationships
              nodeId={selected.id}
              categories={categories}
              resources={resources}
              relations={relations}
              placements={placements}
              onResource={(resource) => setResources((current) => [...current, resource])}
              onResourceUpdate={(resource) => setResources((current) => current.map((candidate) => candidate.id === resource.id ? resource : candidate))}
              onRelation={(relation) => setRelations((current) => [...current, relation])}
              onPlacement={(placement) => setPlacements((current) => [...current, placement])}
              onArchive={async () => {
                const result = await archiveCatalogNode('offering', selected.id as string);
                if (!result.ok) return setMessage(result.error);
                setItems((current) => current.filter((item) => item.id !== selected.id));
                setSelectedId(null);
                setMessage('Offering archived. Its stable ID and order history are preserved.');
              }}
            /> : null}
          </>
        ) : selectedFolderId && categories.some((folder) => folder.id === selectedFolderId) ? (
          <CatalogFolderPanel
            folder={categories.find((category) => category.id === selectedFolderId) as ContentCategory}
            categories={categories}
            onSaved={(folder) => setCategories((current) => current.map((candidate) => candidate.id === folder.id ? folder : candidate))}
            onArchive={async () => {
              const result = await archiveCatalogNode('folder', selectedFolderId);
              if (!result.ok) return setMessage(result.error);
              setCategories((current) => current.filter((folder) => folder.id !== selectedFolderId));
              setSelectedFolderId(null);
              setMessage('Folder archived. Its stable ID and history are preserved.');
            }}
          />
        ) : <div className="content-empty">Choose an offering or folder from the catalog hierarchy.</div>}
        {message ? <p className="content-message" role="status">{message}</p> : null}
      </div>
    </div>
  );
}

function MenuThumb({ item }: { item: Pick<ContentMenuItem, 'name' | 'imageUrl'> }) {
  return <ManagedThumbnail url={item.imageUrl} alt={`${item.name} thumbnail`} />;
}

function MenuItemForm({
  initial,
  categories,
  pending,
  onAddCategory,
  onUpdateCategory,
  onSave,
}: {
  initial: MenuItemDraft | ContentMenuItem;
  categories: ContentCategory[];
  pending: boolean;
  onAddCategory: (category: ContentCategory) => void;
  onUpdateCategory: (category: ContentCategory) => void;
  onSave: (draft: MenuItemDraft, expectedUpdatedAt: string | null) => void;
}) {
  const [draft, setDraft] = useState<MenuItemDraft>({ ...initial });
  const [categoryTitle, setCategoryTitle] = useState('');
  const [showCategory, setShowCategory] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [localMessage, setLocalMessage] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const objectUrlRef = useRef<string | null>(null);
  const expectedUpdatedAt = 'updatedAt' in initial ? initial.updatedAt : null;
  const selectedCategory = categories.find((category) => category.id === draft.categoryId);
  const patch = (next: Partial<MenuItemDraft>) => setDraft((current) => ({ ...current, ...next }));

  useEffect(() => () => {
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
  }, []);

  async function upload(file: File) {
    setUploading(true);
    setLocalMessage(null);
    const localUrl = URL.createObjectURL(file);
    const payload = new FormData();
    payload.set('family', 'menu');
    payload.set('scope', 'menu-item');
    payload.set('entityKey', draft.id ?? draft.slug);
    payload.set('file', file);
    const result = await uploadContentImage(payload);
    if (result.ok) {
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = result.url ? null : localUrl;
      if (result.url) URL.revokeObjectURL(localUrl);
      patch({ imageUrl: result.url || localUrl });
      setLocalMessage(result.persisted ? 'Image uploaded. Save the item to publish the new picture.' : 'Preview image selected.');
    } else {
      URL.revokeObjectURL(localUrl);
      setLocalMessage(result.error);
    }
    setUploading(false);
  }

  async function createCategory() {
    const result = await addMenuCategory(categoryTitle, '', null);
    if (!result.ok) {
      setLocalMessage(result.error);
      return;
    }
    onAddCategory(result.category);
    patch({ categoryId: result.category.id });
    setCategoryTitle('');
    setShowCategory(false);
    setLocalMessage(result.persisted ? 'Category created.' : 'Preview category created.');
  }

  return (
    <div className="content-form-grid">
      <div className="content-form-fields">
        <label className="field">Offering name<input value={draft.name} onChange={(event) => {
          const name = event.target.value;
          patch({ name, ...(draft.id ? {} : { slug: slugFromLabel(name) }) });
        }} /></label>
        <div className="content-inline-fields">
          <label className="field">Category<select value={draft.categoryId} onChange={(event) => patch({ categoryId: event.target.value })}>
            {categories.map((category) => <option key={category.id} value={category.id}>{category.title}</option>)}
          </select></label>
          <label className="field">Base / no-size price<input type="number" min="0" step="0.01" value={(draft.basePriceCents / 100).toFixed(2)} onChange={(event) => patch({ basePriceCents: Math.round(Number(event.target.value) * 100) })} /></label>
        </div>
        <button type="button" className="content-text-button" onClick={() => setShowCategory((value) => !value)}>Add a category</button>
        {showCategory ? <div className="content-inline-action"><label className="field">New category<input value={categoryTitle} onChange={(event) => setCategoryTitle(event.target.value)} /></label><button className="button secondary" type="button" onClick={() => void createCategory()}>Create</button></div> : null}
        {selectedCategory
          ? <CategoryEditor key={draft.categoryId} category={selectedCategory} categories={categories} onSaved={onUpdateCategory} compact />
          : null}
        <label className="field">Description<textarea rows={4} maxLength={600} value={draft.description} onChange={(event) => patch({ description: event.target.value })} /></label>
        <div className="content-inline-fields">
          <label className="field">URL slug<input value={draft.slug} onChange={(event) => patch({ slug: slugFromLabel(event.target.value) })} /></label>
          <label className="field">Sort order<input type="number" min="0" value={draft.sortOrder} onChange={(event) => patch({ sortOrder: Number(event.target.value) })} /></label>
        </div>
        <div className="content-check-row">
          <label><input type="checkbox" checked={draft.isListed} onChange={(event) => patch({ isListed: event.target.checked })} /> Listed in ordering apps</label>
          <label><input type="checkbox" checked={draft.is86d} onChange={(event) => patch({ is86d: event.target.checked })} /> Temporarily 86’d</label>
        </div>
        <label className="field">Audience<select value={draft.audience} onChange={(event) => patch({ audience: event.target.value as ContentMenuItem['audience'] })}>
          <option value="public">Public</option><option value="staff">Staff</option>
          <option value="manager">Managers</option><option value="owner">Owners</option>
        </select></label>
        <MenuOrderingEditor
          sizes={draft.sizes}
          optionGroups={draft.optionGroups}
          onSizesChange={(sizes) => patch({ sizes })}
          onOptionGroupsChange={(optionGroups) => patch({ optionGroups })}
        />
      </div>
      <div className="content-media-card">
        <p className="eyebrow">Offering thumbnail</p>
        <ManagedThumbnail url={draft.imageUrl} alt={`${draft.name} item picture`} showStatus />
        <input ref={fileRef} className="sr-only" type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void upload(file);
        }} />
        <button type="button" className="button secondary content-square-button" disabled={uploading} onClick={() => fileRef.current?.click()}>
          <ContentIcon kind="upload" /> {uploading ? 'Uploading…' : draft.imageUrl ? 'Replace picture' : 'Upload picture'}
        </button>
        <label className="field">Or image URL<input type="url" value={draft.imageUrl ?? ''} onChange={(event) => patch({ imageUrl: event.target.value || null })} /></label>
        <small>JPEG, PNG, or WebP · up to 6 MB. The item name is used as accessible alt text.</small>
        {'mediaVersions' in initial && initial.mediaVersions.length > 0 ? (
          <div className="content-media-history">
            <div><strong>Thumbnail history</strong><small>Choose any previous version, then save to restore it everywhere.</small></div>
            <div className="content-media-history-grid">
              {initial.mediaVersions.slice(0, 8).map((version) => (
                <button
                  type="button"
                  key={version.id}
                  className={draft.imageUrl === version.url ? 'active' : ''}
                  aria-label={`Use thumbnail from ${new Date(version.createdAt).toLocaleString()}`}
                  onClick={() => patch({ imageUrl: version.url })}
                >
                  <ManagedThumbnail url={version.url} alt={`Thumbnail from ${new Date(version.createdAt).toLocaleDateString()}`} className="content-history-thumb" />
                  <time dateTime={version.createdAt}>{new Date(version.createdAt).toLocaleDateString()}</time>
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </div>
      <div className="content-form-footer">
        <button className="button content-square-button" type="button" disabled={pending || uploading} onClick={() => onSave(draft, expectedUpdatedAt)}>{pending ? 'Saving…' : 'Save offering'}</button>
        {localMessage ? <span role="status">{localMessage}</span> : null}
      </div>
    </div>
  );
}

function CategoryEditor({
  category, categories, onSaved, compact = false,
}: {
  category: ContentCategory;
  categories: ContentCategory[];
  onSaved: (category: ContentCategory) => void;
  compact?: boolean;
}) {
  const [title, setTitle] = useState(category.title);
  const [tagline, setTagline] = useState(category.tagline);
  const [parentId, setParentId] = useState(category.parentId ?? '');
  const [audience, setAudience] = useState(category.audience);
  const [imageUrl, setImageUrl] = useState(category.imageUrl);
  const [uploading, setUploading] = useState(false);
  const folderFileRef = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState<string | null>(null);
  const fields = (
    <>
      <div className="content-inline-fields">
        <label className="field">Folder name<input value={title} onChange={(event) => setTitle(event.target.value)} /></label>
        <label className="field">Storefront tagline<input maxLength={160} value={tagline} onChange={(event) => setTagline(event.target.value)} /></label>
      </div>
      <div className="content-inline-fields">
        <label className="field">Parent folder<select value={parentId} onChange={(event) => setParentId(event.target.value)}>
          <option value="">Catalog root</option>
          {categories.filter((candidate) => candidate.id !== category.id).map((candidate) => (
            <option key={candidate.id} value={candidate.id}>{catalogPath(categories, candidate.id)}</option>
          ))}
        </select></label>
        <label className="field">Audience<select value={audience} onChange={(event) => setAudience(event.target.value as ContentCategory['audience'])}>
          <option value="public">Public</option><option value="staff">Staff</option>
          <option value="manager">Managers</option><option value="owner">Owners</option>
        </select></label>
      </div>
      <button type="button" className="button secondary content-square-button" onClick={async () => {
        const result = await saveMenuCategory(category.id, title, tagline, parentId || null, audience, imageUrl);
        if (!result.ok) return setMessage(result.error);
        onSaved({
          ...result.category,
          sortOrder: result.persisted ? result.category.sortOrder : category.sortOrder,
          mediaVersions: category.mediaVersions,
        });
        setMessage(result.persisted ? 'Folder saved to the catalog draft.' : 'Preview folder updated.');
      }}>Save folder</button>
      {!compact ? <div className="content-media-card catalog-folder-media">
        <p className="eyebrow">Folder thumbnail</p>
        <ManagedThumbnail url={imageUrl} alt={`${title} folder thumbnail`} showStatus />
        <input ref={folderFileRef} className="sr-only" type="file" accept="image/jpeg,image/png,image/webp" onChange={async (event) => {
          const file = event.target.files?.[0];
          if (!file) return;
          setUploading(true);
          const payload = new FormData();
          payload.set('family', 'menu'); payload.set('scope', 'catalog-folder');
          payload.set('entityKey', category.id); payload.set('file', file);
          const result = await uploadContentImage(payload);
          if (result.ok && result.url) setImageUrl(result.url); else if (!result.ok) setMessage(result.error);
          setUploading(false);
        }} />
        <button type="button" className="button secondary content-square-button" disabled={uploading} onClick={() => folderFileRef.current?.click()}>
          <ContentIcon kind="upload" /> {uploading ? 'Uploading…' : imageUrl ? 'Replace thumbnail' : 'Upload thumbnail'}
        </button>
        <label className="field">Or image URL<input type="url" value={imageUrl ?? ''} onChange={(event) => setImageUrl(event.target.value || null)} /></label>
        {category.mediaVersions.length > 0 ? <div className="content-media-history">
          <div><strong>Thumbnail history</strong><small>Select an earlier image, then save the folder.</small></div>
          <div className="content-media-history-grid">{category.mediaVersions.slice(0, 8).map((version) => (
            <button type="button" key={version.id} className={imageUrl === version.url ? 'active' : ''} onClick={() => setImageUrl(version.url)}>
              <ManagedThumbnail url={version.url} alt={`Folder thumbnail from ${new Date(version.createdAt).toLocaleDateString()}`} className="content-history-thumb" />
              <time dateTime={version.createdAt}>{new Date(version.createdAt).toLocaleDateString()}</time>
            </button>
          ))}</div>
        </div> : null}
      </div> : null}
      {message ? <small role="status">{message}</small> : null}
    </>
  );
  return compact ? <details className="menu-category-editor"><summary>Edit “{category.title}” folder</summary>{fields}</details> : fields;
}

function CatalogFolderPanel({
  folder, categories, onSaved, onArchive,
}: {
  folder: ContentCategory;
  categories: ContentCategory[];
  onSaved: (folder: ContentCategory) => void;
  onArchive: () => void;
}) {
  return (
    <div className="catalog-folder-panel">
      <div className="catalog-folder-preview">
        <ManagedThumbnail url={folder.imageUrl} alt={`${folder.title} folder thumbnail`} showStatus />
        <div><p className="eyebrow">Folder path</p><strong>{catalogPath(categories, folder.id)}</strong><small>Folder media and aliases use the same stable catalog ID on every surface.</small></div>
      </div>
      <CategoryEditor category={folder} categories={categories} onSaved={onSaved} />
      <button type="button" className="button secondary content-square-button" onClick={onArchive}>Archive empty folder</button>
    </div>
  );
}

function CatalogRelationships({
  nodeId, categories, resources, relations, placements, onResource, onResourceUpdate, onRelation, onPlacement, onArchive,
}: {
  nodeId: string;
  categories: ContentCategory[];
  resources: ContentCatalogResource[];
  relations: ContentCatalogRelation[];
  placements: ContentCatalogPlacement[];
  onResource: (resource: ContentCatalogResource) => void;
  onResourceUpdate: (resource: ContentCatalogResource) => void;
  onRelation: (relation: ContentCatalogRelation) => void;
  onPlacement: (placement: ContentCatalogPlacement) => void;
  onArchive: () => void;
}) {
  const [kind, setKind] = useState<ContentCatalogResource['kind']>('material');
  const [relationKind, setRelationKind] = useState<ContentCatalogRelation['kind']>('requires');
  const [title, setTitle] = useState('');
  const [summary, setSummary] = useState('');
  const [selectedResource, setSelectedResource] = useState('');
  const [aliasParentId, setAliasParentId] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const linked = relations.filter((relation) => relation.sourceId === nodeId)
    .map((relation) => ({ relation, resource: resources.find((resource) => resource.id === relation.targetId) }))
    .filter((entry): entry is { relation: ContentCatalogRelation; resource: ContentCatalogResource } => Boolean(entry.resource));
  const aliases = placements.filter((placement) => placement.nodeId === nodeId && !placement.isPrimary);
  return (
    <section className="catalog-relationships" aria-labelledby="catalog-relationships-title">
      <div className="content-section-intro">
        <div><p className="eyebrow">Connected content graph</p><h3 id="catalog-relationships-title">Materials, procedures, knowledge, skills, and training</h3></div>
        <span className="pill">{linked.length} linked</span>
      </div>
      <div className="catalog-resource-grid">
        {linked.map(({ relation, resource }) => (
          <article key={relation.id} className="catalog-resource-card">
            <ResourceThumbnailEditor resource={resource} onSaved={onResourceUpdate} />
            <span>{resource.kind.replace('_', ' ')}</span><strong>{resource.title}</strong>
            <small>{relation.kind} · {resource.audience}</small><p>{resource.summary || 'No summary yet.'}</p>
          </article>
        ))}
        {linked.length === 0 ? <div className="content-empty compact">No linked resources yet. Link an existing resource or create one below.</div> : null}
      </div>
      <div className="catalog-link-builder">
        <label className="field">Alias placement<select value={aliasParentId} onChange={(event) => setAliasParentId(event.target.value)}>
          <option value="">Choose another folder</option>
          {categories.map((folder) => <option key={folder.id} value={folder.id}>{catalogPath(categories, folder.id)}</option>)}
        </select></label>
        <button type="button" className="button secondary content-square-button" disabled={!aliasParentId} onClick={async () => {
          const result = await addCatalogAlias(nodeId, aliasParentId);
          if (!result.ok) return setMessage(result.error);
          onPlacement(result.placement); setAliasParentId('');
          setMessage(result.persisted ? 'Alias added to the catalog draft.' : 'Preview alias added.');
        }}>Add alias</button>
        <small>{aliases.length > 0 ? aliases.map((alias) => catalogPath(categories, alias.parentId ?? '')).join(' · ') : 'No aliases. The offering has one canonical identity.'}</small>
      </div>
      <div className="catalog-link-builder">
        <label className="field">Relationship<select value={relationKind} onChange={(event) => setRelationKind(event.target.value as ContentCatalogRelation['kind'])}>
          {['requires', 'follows', 'teaches', 'develops', 'covers', 'prerequisite', 'related', 'substitute'].map((value) => <option key={value}>{value}</option>)}
        </select></label>
        <label className="field">Existing resource<select value={selectedResource} onChange={(event) => setSelectedResource(event.target.value)}>
          <option value="">Choose a resource</option>
          {resources.map((resource) => <option key={resource.id} value={resource.id}>{resource.kind.replace('_', ' ')} · {resource.title}</option>)}
        </select></label>
        <button type="button" className="button secondary content-square-button" disabled={!selectedResource} onClick={async () => {
          const result = await linkCatalogResource(nodeId, selectedResource, relationKind);
          if (!result.ok) return setMessage(result.error);
          onRelation(result.relation); setSelectedResource('');
          setMessage(result.persisted ? 'Resource linked in the catalog draft.' : 'Preview relationship added.');
        }}>Link resource</button>
      </div>
      <details className="catalog-resource-create">
        <summary>Create a reusable resource</summary>
        <div className="content-inline-fields">
          <label className="field">Resource type<select value={kind} onChange={(event) => setKind(event.target.value as ContentCatalogResource['kind'])}>
            {['material', 'specification', 'procedure', 'recipe', 'knowledge', 'skill', 'training_module', 'training_lesson'].map((value) => <option key={value}>{value.replace('_', ' ')}</option>)}
          </select></label>
          <label className="field">Title<input value={title} onChange={(event) => setTitle(event.target.value)} /></label>
        </div>
        <label className="field">Summary<textarea rows={3} value={summary} onChange={(event) => setSummary(event.target.value)} /></label>
        <button type="button" className="button secondary content-square-button" disabled={title.trim().length < 2} onClick={async () => {
          const result = await addCatalogResource(kind, title, summary, kind === 'material' || kind === 'specification' ? 'public' : 'staff');
          if (!result.ok) return setMessage(result.error);
          onResource(result.resource); setSelectedResource(result.resource.id); setTitle(''); setSummary('');
          setMessage(result.persisted ? 'Resource created. Link it to this offering when ready.' : 'Preview resource created.');
        }}>Create resource</button>
      </details>
      <button type="button" className="button secondary content-square-button" onClick={onArchive}>Archive offering</button>
      {message ? <p className="content-message" role="status">{message}</p> : null}
    </section>
  );
}

function ResourceThumbnailEditor({
  resource, onSaved,
}: {
  resource: ContentCatalogResource;
  onSaved: (resource: ContentCatalogResource) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  async function choose(file: File) {
    setBusy(true); setMessage(null);
    const payload = new FormData();
    payload.set('family', 'menu'); payload.set('scope', 'catalog-resource');
    payload.set('entityKey', resource.id); payload.set('file', file);
    const upload = await uploadContentImage(payload);
    if (!upload.ok) { setBusy(false); return setMessage(upload.error); }
    const url = upload.url || URL.createObjectURL(file);
    const saved = await saveCatalogResourceImage(resource.id, url);
    if (!saved.ok) { setBusy(false); return setMessage(saved.error); }
    onSaved({ ...resource, imageUrl: url });
    setMessage(saved.persisted ? 'Resource thumbnail saved.' : 'Preview thumbnail selected.');
    setBusy(false);
  }
  return <div className="catalog-resource-media">
    <ManagedThumbnail url={resource.imageUrl} alt={`${resource.title} thumbnail`} />
    <input ref={inputRef} className="sr-only" type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => {
      const file = event.target.files?.[0]; if (file) void choose(file);
    }} />
    <button type="button" className="content-text-button" disabled={busy} onClick={() => inputRef.current?.click()}>{busy ? 'Uploading…' : resource.imageUrl ? 'Replace' : 'Add image'}</button>
    {resource.mediaVersions.length > 0 ? <details><summary>History</summary>{resource.mediaVersions.slice(0, 6).map((version) => (
      <button type="button" key={version.id} className="content-text-button" onClick={async () => {
        const saved = await saveCatalogResourceImage(resource.id, version.url);
        if (saved.ok) onSaved({ ...resource, imageUrl: version.url }); else setMessage(saved.error);
      }}>{new Date(version.createdAt).toLocaleDateString()}</button>
    ))}</details> : null}
    {message ? <small role="status">{message}</small> : null}
  </div>;
}

function CatalogTree({
  categories, items, expanded, selectedFolderId, selectedItemId,
  onToggle, onSelectFolder, onSelectItem, onMove, parentId = null, depth = 0,
}: {
  categories: ContentCategory[];
  items: ContentMenuItem[];
  expanded: Set<string>;
  selectedFolderId: string | null;
  selectedItemId: string | null;
  onToggle: (id: string) => void;
  onSelectFolder: (id: string) => void;
  onSelectItem: (id: string) => void;
  onMove: (kind: 'folder' | 'offering', nodeId: string, parentId: string) => void;
  parentId?: string | null;
  depth?: number;
}) {
  const folders = categories.filter((folder) => folder.parentId === parentId && !folder.archived).sort((a, b) => a.sortOrder - b.sortOrder);
  return <>{folders.map((folder) => {
    const open = expanded.has(folder.id);
    const folderItems = items.filter((item) => item.categoryId === folder.id).sort((a, b) => a.sortOrder - b.sortOrder);
    const childCount = categories.filter((candidate) => candidate.parentId === folder.id).length + folderItems.length;
    return (
      <div key={folder.id} className="catalog-tree-group" role="treeitem" aria-expanded={open}>
        <div className={`catalog-folder-row ${selectedFolderId === folder.id ? 'active' : ''}`} style={{ '--tree-depth': depth } as CSSProperties}
          onDragOver={(event) => event.preventDefault()} onDrop={(event) => {
            event.preventDefault();
            const [kind, nodeId] = event.dataTransfer.getData('application/x-catalog-node').split(':');
            if ((kind === 'folder' || kind === 'offering') && nodeId) onMove(kind, nodeId, folder.id);
          }}>
          <button type="button" className="catalog-tree-toggle" aria-label={`${open ? 'Collapse' : 'Expand'} ${folder.title}`} onClick={() => onToggle(folder.id)}>{open ? '⌄' : '›'}</button>
          <button type="button" className="catalog-folder-select" draggable onDragStart={(event) => event.dataTransfer.setData('application/x-catalog-node', `folder:${folder.id}`)} onClick={() => onSelectFolder(folder.id)}>
            <span className="catalog-folder-icon">▰</span><span><strong>{folder.title}</strong><small>{childCount} entries · {folder.audience}</small></span>
          </button>
        </div>
        {open ? <div role="group">
          <CatalogTree categories={categories} items={items} expanded={expanded} selectedFolderId={selectedFolderId} selectedItemId={selectedItemId} onToggle={onToggle} onSelectFolder={onSelectFolder} onSelectItem={onSelectItem} onMove={onMove} parentId={folder.id} depth={depth + 1} />
          {folderItems.map((item) => (
            <button type="button" role="treeitem" draggable key={item.id} className={`catalog-offering-row ${selectedItemId === item.id ? 'active' : ''}`} style={{ '--tree-depth': depth + 1 } as CSSProperties}
              onDragStart={(event) => event.dataTransfer.setData('application/x-catalog-node', `offering:${item.id}`)} onClick={() => onSelectItem(item.id)}>
              <MenuThumb item={item} /><span><strong>{item.name}</strong><small>${(displayPriceCents(item) / 100).toFixed(2)}</small></span>
            </button>
          ))}
        </div> : null}
      </div>
    );
  })}</>;
}

function catalogPath(categories: ContentCategory[], folderId: string): string {
  const byId = new Map(categories.map((folder) => [folder.id, folder]));
  const path: string[] = [];
  const seen = new Set<string>();
  let current = byId.get(folderId);
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    path.unshift(current.title);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return path.join(' / ') || 'Catalog root';
}

function displayPriceCents(item: Pick<ContentMenuItem, 'basePriceCents' | 'sizes'>): number {
  return item.sizes.length > 0
    ? Math.min(...item.sizes.map((size) => size.priceCents))
    : item.basePriceCents;
}

function catalogValidationSummary(
  categories: ContentCategory[],
  items: ContentMenuItem[],
  resources: ContentCatalogResource[],
  relations: ContentCatalogRelation[],
): { errors: string[]; warnings: string[] } {
  const folders = new Map(categories.map((folder) => [folder.id, folder]));
  const resourceIds = new Set(resources.map((resource) => resource.id));
  const nodeIds = new Set([...categories.map((folder) => folder.id), ...items.map((item) => item.id)]);
  const errors: string[] = [];
  for (const folder of categories) {
    let current: ContentCategory | undefined = folder;
    const seen = new Set<string>();
    let depth = 0;
    while (current) {
      if (seen.has(current.id)) { errors.push(`${folder.title}: folder cycle detected.`); break; }
      seen.add(current.id); depth += 1;
      current = current.parentId ? folders.get(current.parentId) : undefined;
    }
    if (depth > 5) errors.push(`${folder.title}: path exceeds five folder levels.`);
    if (folder.parentId && !folders.has(folder.parentId)) errors.push(`${folder.title}: parent folder is missing.`);
  }
  for (const item of items) if (!folders.has(item.categoryId)) errors.push(`${item.name}: primary folder is missing.`);
  for (const relation of relations) {
    if (!nodeIds.has(relation.sourceId) && !resourceIds.has(relation.sourceId)) errors.push(`Relationship ${relation.id}: source is missing.`);
    if (!nodeIds.has(relation.targetId) && !resourceIds.has(relation.targetId)) errors.push(`Relationship ${relation.id}: target is missing.`);
  }
  const warnings = [
    ...categories.filter((folder) => !folder.imageUrl).map((folder) => `${folder.title}: add a folder thumbnail.`),
    ...items.filter((item) => !item.imageUrl).map((item) => `${item.name}: add an offering thumbnail.`),
    ...resources.filter((resource) => !resource.imageUrl).map((resource) => `${resource.title}: add a resource thumbnail.`),
  ];
  return { errors: [...new Set(errors)], warnings: [...new Set(warnings)] };
}
