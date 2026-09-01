'use client';

import { useEffect, useRef, useState } from 'react';

import { addMenuCategory, uploadContentImage } from '@/app/(console)/content/actions';
import { slugFromLabel, type ContentCategory, type ContentMenuItem, type MenuItemDraft } from '@/lib/content-model';

import { CategoryEditor } from './catalog-category-editor';
import { Icon } from './icon';
import { ManagedThumbnail } from './managed-thumbnail';
import { MenuOrderingEditor } from './menu-ordering-editor';

type MenuItemFormProps = {
  initial: MenuItemDraft | ContentMenuItem;
  categories: ContentCategory[];
  pending: boolean;
  onAddCategory: (category: ContentCategory) => void;
  onUpdateCategory: (category: ContentCategory) => void;
  onSave: (draft: MenuItemDraft, expectedUpdatedAt: string | null) => void;
};

export function CatalogMenuItemForm(props: MenuItemFormProps) {
  const { initial, categories } = props;
  const [draft, setDraft] = useState<MenuItemDraft>({ ...initial });
  const [categoryTitle, setCategoryTitle] = useState('');
  const [showCategory, setShowCategory] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
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
    setMessage(null);
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
      setMessage(result.persisted ? 'Image uploaded. Save the offering to publish it.' : 'Preview image selected.');
    } else {
      URL.revokeObjectURL(localUrl);
      setMessage(result.error);
    }
    setUploading(false);
  }

  async function createCategory() {
    const result = await addMenuCategory(categoryTitle, '', null);
    if (!result.ok) return setMessage(result.error);
    props.onAddCategory(result.category);
    patch({ categoryId: result.category.id });
    setCategoryTitle('');
    setShowCategory(false);
    setMessage(result.persisted ? 'Category created.' : 'Preview category created.');
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
        {selectedCategory ? <CategoryEditor key={draft.categoryId} category={selectedCategory} categories={categories} onSaved={props.onUpdateCategory} compact /> : null}
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
          <option value="public">Public</option><option value="staff">Staff</option><option value="manager">Managers</option><option value="owner">Owners</option>
        </select></label>
        <MenuOrderingEditor sizes={draft.sizes} optionGroups={draft.optionGroups} onSizesChange={(sizes) => patch({ sizes })} onOptionGroupsChange={(optionGroups) => patch({ optionGroups })} />
      </div>
      <div className="content-media-card">
        <p className="eyebrow">Offering thumbnail</p>
        <ManagedThumbnail url={draft.imageUrl} alt={`${draft.name} item picture`} showStatus />
        <input ref={fileRef} className="sr-only" type="file" aria-label={`Upload ${draft.name} thumbnail file`} accept="image/jpeg,image/png,image/webp" onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void upload(file);
        }} />
        <button type="button" className="button secondary content-square-button" disabled={uploading} onClick={() => fileRef.current?.click()}><Icon name="upload" /> {uploading ? 'Uploading…' : draft.imageUrl ? 'Replace picture' : 'Upload picture'}</button>
        <label className="field">Or image URL<input type="url" value={draft.imageUrl ?? ''} onChange={(event) => patch({ imageUrl: event.target.value || null })} /></label>
        <small>JPEG, PNG, or WebP · up to 6 MB. The offering name supplies accessible alt text.</small>
        {'mediaVersions' in initial && initial.mediaVersions.length > 0 ? <div className="content-media-history">
          <div><strong>Thumbnail history</strong><small>Choose a previous version, then save to restore it everywhere.</small></div>
          <div className="content-media-history-grid">{initial.mediaVersions.slice(0, 8).map((version) => (
            <button type="button" key={version.id} className={draft.imageUrl === version.url ? 'active' : ''} aria-label={`Use thumbnail from ${new Date(version.createdAt).toLocaleString()}`} onClick={() => patch({ imageUrl: version.url })}>
              <ManagedThumbnail url={version.url} alt={`Thumbnail from ${new Date(version.createdAt).toLocaleDateString()}`} className="content-history-thumb" />
              <time dateTime={version.createdAt}>{new Date(version.createdAt).toLocaleDateString()}</time>
            </button>
          ))}</div>
        </div> : null}
      </div>
      <div className="content-form-footer">
        <button className="button content-square-button" type="button" disabled={props.pending || uploading} onClick={() => props.onSave(draft, expectedUpdatedAt)}>{props.pending ? 'Saving…' : 'Save offering'}</button>
        {message ? <span role="status">{message}</span> : null}
      </div>
    </div>
  );
}
