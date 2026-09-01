'use client';

import { useRef, useState } from 'react';

import { saveMenuCategory, uploadContentImage } from '@/app/(console)/content/actions';
import { catalogPath } from '@/lib/catalog-insights';
import type { ContentCategory } from '@/lib/content-model';

import { Icon } from './icon';
import { ManagedThumbnail } from './managed-thumbnail';

type CategoryEditorProps = {
  category: ContentCategory;
  categories: ContentCategory[];
  onSaved: (category: ContentCategory) => void;
  compact?: boolean;
};

export function CategoryEditor({ category, categories, onSaved, compact = false }: CategoryEditorProps) {
  const [title, setTitle] = useState(category.title);
  const [tagline, setTagline] = useState(category.tagline);
  const [parentId, setParentId] = useState(category.parentId ?? '');
  const [audience, setAudience] = useState(category.audience);
  const [imageUrl, setImageUrl] = useState(category.imageUrl);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function upload(file: File) {
    setUploading(true);
    const payload = new FormData();
    payload.set('family', 'menu');
    payload.set('scope', 'catalog-folder');
    payload.set('entityKey', category.id);
    payload.set('file', file);
    const result = await uploadContentImage(payload);
    if (result.ok && result.url) setImageUrl(result.url);
    else if (!result.ok) setMessage(result.error);
    setUploading(false);
  }

  async function save() {
    const result = await saveMenuCategory(category.id, title, tagline, parentId || null, audience, imageUrl);
    if (!result.ok) return setMessage(result.error);
    onSaved({
      ...result.category,
      sortOrder: result.persisted ? result.category.sortOrder : category.sortOrder,
      mediaVersions: category.mediaVersions,
    });
    setMessage(result.persisted ? 'Folder saved to the catalog draft.' : 'Preview folder updated.');
  }

  const fields = <>
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
    <button type="button" className="button secondary content-square-button" onClick={() => void save()}>Save folder</button>
    {!compact ? <div className="content-media-card catalog-folder-media">
      <p className="eyebrow">Folder thumbnail</p>
      <ManagedThumbnail url={imageUrl} alt={`${title} folder thumbnail`} showStatus />
      <input ref={fileRef} className="sr-only" type="file" aria-label={`Upload ${title} folder thumbnail file`} accept="image/jpeg,image/png,image/webp" onChange={(event) => {
        const file = event.target.files?.[0];
        if (file) void upload(file);
      }} />
      <button type="button" className="button secondary content-square-button" disabled={uploading} onClick={() => fileRef.current?.click()}>
        <Icon name="upload" /> {uploading ? 'Uploading…' : imageUrl ? 'Replace thumbnail' : 'Upload thumbnail'}
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
  </>;
  return compact ? <details className="menu-category-editor"><summary>Edit “{category.title}” folder</summary>{fields}</details> : fields;
}

export function CatalogFolderPanel(props: Omit<CategoryEditorProps, 'category' | 'compact'> & {
  folder: ContentCategory;
  onArchive: () => void;
}) {
  return (
    <div className="catalog-folder-panel">
      <div className="catalog-folder-preview">
        <ManagedThumbnail url={props.folder.imageUrl} alt={`${props.folder.title} folder thumbnail`} showStatus />
        <div><p className="eyebrow">Folder path</p><strong>{catalogPath(props.categories, props.folder.id)}</strong><small>Folder media and aliases use the same stable catalog ID on every surface.</small></div>
      </div>
      <CategoryEditor category={props.folder} categories={props.categories} onSaved={props.onSaved} />
      <button type="button" className="button secondary content-square-button" onClick={props.onArchive}>Archive empty folder</button>
    </div>
  );
}
