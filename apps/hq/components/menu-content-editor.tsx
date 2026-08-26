'use client';

import { useMemo, useRef, useState, useTransition } from 'react';

import {
  addMenuCategory,
  saveMenuItem,
  saveMenuCategory,
  setMenuPublished,
  uploadContentImage,
} from '@/app/(console)/content/actions';
import {
  slugFromLabel,
  type ContentCategory,
  type ContentMenu,
  type ContentMenuItem,
  type MenuItemDraft,
} from '@/lib/content-model';

import { ContentIcon } from './content-workspace';
import { MenuOrderingEditor } from './menu-ordering-editor';

export function MenuContentEditor({
  initialMenu,
  initialCategories,
  initialItems,
}: {
  initialMenu: ContentMenu;
  initialCategories: ContentCategory[];
  initialItems: ContentMenuItem[];
}) {
  const [menu, setMenu] = useState(initialMenu);
  const [categories, setCategories] = useState(initialCategories);
  const [items, setItems] = useState(initialItems);
  const [selectedId, setSelectedId] = useState<string | null>(initialItems[0]?.id ?? null);
  const [newDraft, setNewDraft] = useState<MenuItemDraft | null>(null);
  const [query, setQuery] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const selected = newDraft ?? items.find((item) => item.id === selectedId) ?? null;
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return needle ? items.filter((item) => item.name.toLowerCase().includes(needle)) : items;
  }, [items, query]);

  function createItem() {
    setNewDraft({
      id: null, name: 'New item', slug: 'new-item', description: '',
      categoryId: categories[0]?.id ?? '', basePriceCents: 0, imageUrl: null,
      sizes: [], optionGroups: [],
      isListed: false, is86d: false, sortOrder: items.length * 10 + 10,
    });
    setSelectedId(null);
    setMessage(null);
  }

  function selectItem(id: string) {
    setNewDraft(null);
    setSelectedId(id);
    setMessage(null);
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
    setMessage(persisted ? 'Menu item saved.' : 'Preview updated. Connect Supabase to persist changes.');
  }

  return (
    <div className="content-editor-grid">
      <aside className="content-rail" aria-label="Menu items">
        <div className="content-rail-header">
          <div><strong>{menu.name}</strong><span>{items.length} items</span></div>
          <span className={`pill ${menu.isPublished ? 'success' : 'warning'}`}>{menu.isPublished ? 'Live' : 'Draft'}</span>
        </div>
        <label className="content-search">
          <span className="sr-only">Search menu items</span>
          <input type="search" placeholder="Search items" value={query} onChange={(event) => setQuery(event.target.value)} />
        </label>
        <div className="content-rail-list">
          {filtered.map((item) => (
            <button type="button" key={item.id} className={selectedId === item.id && !newDraft ? 'active' : ''} onClick={() => selectItem(item.id)}>
              <MenuThumb item={item} />
              <span><strong>{item.name}</strong><small>{categories.find((category) => category.id === item.categoryId)?.title ?? 'Uncategorized'} · ${(displayPriceCents(item) / 100).toFixed(2)}</small></span>
              {!item.isListed || item.is86d ? <i aria-label={item.is86d ? '86’d' : 'Unlisted'} /> : null}
            </button>
          ))}
        </div>
        <button type="button" className="content-add-button" onClick={createItem}><ContentIcon kind="plus" /> Add menu item</button>
      </aside>

      <div className="content-editor-panel">
        <div className="content-panel-toolbar">
          <div><p className="eyebrow">Storefront catalog</p><h2>{selected ? selected.name : 'Choose an item'}</h2></div>
          <button
            type="button"
            className="button secondary content-square-button"
            disabled={pending}
            onClick={() => startTransition(async () => {
              const result = await setMenuPublished(menu.id, !menu.isPublished, menu.updatedAt);
              if (result.ok) {
                setMenu((current) => ({ ...current, isPublished: !current.isPublished, updatedAt: result.updatedAt }));
                setMessage(result.persisted ? `Menu ${menu.isPublished ? 'moved to draft' : 'published'}.` : 'Preview publication state updated.');
              } else setMessage(result.error);
            })}
          >
            {menu.isPublished ? 'Unpublish menu' : 'Publish menu'}
          </button>
        </div>
        {selected ? (
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
        ) : <div className="content-empty">Choose a menu item or add a new one.</div>}
        {message ? <p className="content-message" role="status">{message}</p> : null}
      </div>
    </div>
  );
}

function MenuThumb({ item }: { item: Pick<ContentMenuItem, 'name' | 'imageUrl'> }) {
  return item.imageUrl
    ? <span className="content-thumb image" role="img" aria-label={`${item.name} image`} style={{ backgroundImage: `url("${item.imageUrl}")` }} />
    : <span className="content-thumb"><ContentIcon kind="image" /></span>;
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
  const expectedUpdatedAt = 'updatedAt' in initial ? initial.updatedAt : null;
  const selectedCategory = categories.find((category) => category.id === draft.categoryId);
  const patch = (next: Partial<MenuItemDraft>) => setDraft((current) => ({ ...current, ...next }));

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
      patch({ imageUrl: result.url || localUrl });
      setLocalMessage(result.persisted ? 'Image uploaded. Save the item to publish the new picture.' : 'Preview image selected.');
    } else {
      URL.revokeObjectURL(localUrl);
      setLocalMessage(result.error);
    }
    setUploading(false);
  }

  async function createCategory() {
    const result = await addMenuCategory(categoryTitle, '');
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
        <label className="field">Item name<input value={draft.name} onChange={(event) => {
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
          ? <CategoryEditor key={draft.categoryId} category={selectedCategory} onSaved={onUpdateCategory} />
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
        <MenuOrderingEditor
          sizes={draft.sizes}
          optionGroups={draft.optionGroups}
          onSizesChange={(sizes) => patch({ sizes })}
          onOptionGroupsChange={(optionGroups) => patch({ optionGroups })}
        />
      </div>
      <div className="content-media-card">
        <p className="eyebrow">Item picture</p>
        <MenuThumb item={draft} />
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
                  <span style={{ backgroundImage: `url("${version.url}")` }} />
                  <time dateTime={version.createdAt}>{new Date(version.createdAt).toLocaleDateString()}</time>
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </div>
      <div className="content-form-footer">
        <button className="button content-square-button" type="button" disabled={pending || uploading} onClick={() => onSave(draft, expectedUpdatedAt)}>{pending ? 'Saving…' : 'Save menu item'}</button>
        {localMessage ? <span role="status">{localMessage}</span> : null}
      </div>
    </div>
  );
}

function CategoryEditor({ category, onSaved }: { category: ContentCategory; onSaved: (category: ContentCategory) => void }) {
  const [title, setTitle] = useState(category.title);
  const [tagline, setTagline] = useState(category.tagline);
  const [message, setMessage] = useState<string | null>(null);
  return (
    <details className="menu-category-editor">
      <summary>Edit “{category.title}” category</summary>
      <div className="content-inline-fields">
        <label className="field">Category name<input value={title} onChange={(event) => setTitle(event.target.value)} /></label>
        <label className="field">Storefront tagline<input maxLength={160} value={tagline} onChange={(event) => setTagline(event.target.value)} /></label>
      </div>
      <button type="button" className="button secondary content-square-button" onClick={async () => {
        const result = await saveMenuCategory(category.id, title, tagline);
        if (!result.ok) return setMessage(result.error);
        onSaved({ ...result.category, sortOrder: result.persisted ? result.category.sortOrder : category.sortOrder });
        setMessage(result.persisted ? 'Category saved.' : 'Preview category updated.');
      }}>Save category</button>
      {message ? <small role="status">{message}</small> : null}
    </details>
  );
}

function displayPriceCents(item: Pick<ContentMenuItem, 'basePriceCents' | 'sizes'>): number {
  return item.sizes.length > 0
    ? Math.min(...item.sizes.map((size) => size.priceCents))
    : item.basePriceCents;
}
