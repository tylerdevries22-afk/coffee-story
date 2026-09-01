'use client';

import { useMemo, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

import { storageAssetDownload, uploadStorageAsset } from '@/app/(console)/storage/actions';
import { Icon } from '@/components/icon';
import { formatStorageBytes, type StorageAssetKind } from '@/lib/storage-library';
import type { StorageAssetView, StorageWorkspaceData } from '@/lib/storage-data';

type BucketFilter = 'all' | StorageAssetView['bucketId'];

const UPLOAD_OPTIONS: ReadonlyArray<{ kind: StorageAssetKind; label: string; note: string }> = [
  { kind: 'brand_image', label: 'Brand image', note: 'Public JPEG, PNG, or WebP for brand use.' },
  { kind: 'document', label: 'Document', note: 'Private PDFs, office files, CSV, text, or ZIP.' },
  { kind: 'design', label: 'Design source', note: 'Private AI, EPS, PSD, Sketch, Figma, or SVG source.' },
  { kind: 'attachment', label: 'Attachment', note: 'Private supporting file, including photos.' },
];

const KIND_LABEL: Record<StorageAssetKind, string> = {
  menu_image: 'Menu image', brand_image: 'Brand image', training_media: 'Training media',
  document: 'Document', design: 'Design source', attachment: 'Attachment',
};

export function StorageWorkspace({ initial }: { initial: StorageWorkspaceData }) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [bucket, setBucket] = useState<BucketFilter>('all');
  const [kind, setKind] = useState<StorageAssetKind>('document');
  const [query, setQuery] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const selectedOption = UPLOAD_OPTIONS.find((option) => option.kind === kind) ?? UPLOAD_OPTIONS[1]!;
  const assets = useMemo(() => initial.assets.filter((asset) => {
    const matchesBucket = bucket === 'all' || asset.bucketId === bucket;
    const text = `${asset.originalFilename} ${asset.sourceType} ${asset.sourceKey ?? ''}`.toLowerCase();
    return matchesBucket && text.includes(query.trim().toLowerCase());
  }), [bucket, initial.assets, query]);

  function submitUpload(formData: FormData) {
    setMessage(null);
    startTransition(async () => {
      const result = await uploadStorageAsset(formData);
      if (!result.ok) return setMessage(result.error);
      formRef.current?.reset();
      setMessage('File stored and recorded in the asset library.');
      router.refresh();
    });
  }

  function download(asset: StorageAssetView) {
    setDownloadingId(asset.id);
    setMessage(null);
    startTransition(async () => {
      const result = await storageAssetDownload(asset.id);
      setDownloadingId(null);
      if (!result.ok) return setMessage(result.error);
      window.location.assign(result.url);
    });
  }

  if (initial.connection !== 'ready') {
    return <section className="card storage-notice" aria-labelledby="storage-unavailable-title">
      <Icon name="lock" size={22} />
      <div><p className="eyebrow">Storage library</p><h1 id="storage-unavailable-title">Supabase storage is unavailable</h1>
        <p className="subtitle">This screen does not use fixture files. Configure the Supabase browser and server credentials, then reload.</p></div>
    </section>;
  }

  return <div className="storage-workspace">
    <header className="storage-heading">
      <div><p className="eyebrow">Asset governance</p><h1>Storage</h1>
        <p className="subtitle">A registry-backed view of every managed file. Menu and training media stay connected to their content; private files receive expiring download links.</p></div>
      <a className="button button-secondary storage-catalog-link" href="/catalog"><Icon name="menu" size={16} />Manage catalog media</a>
    </header>

    <section className="storage-summary" aria-label="Storage bucket summary">
      {initial.buckets.map((entry) => <article className="card storage-summary-card" key={entry.bucketId}>
        <div className="storage-summary-icon"><Icon name={entry.visibility === 'private' ? 'lock' : 'folder'} size={18} /></div>
        <div><span>{entry.label}</span><strong>{entry.assetCount}</strong><small>{entry.byteLabel} · {entry.visibility}</small></div>
      </article>)}
    </section>

    <section className="card storage-upload-card" aria-labelledby="storage-upload-title">
      <div className="storage-upload-copy"><p className="eyebrow">Add an asset</p><h2 id="storage-upload-title">Store it in the right place</h2>
        <p>Files are given opaque paths and a catalog record—no empty folder markers. Limit: 6 MB per file.</p></div>
      <form ref={formRef} action={submitUpload} className="storage-upload-form">
        <label>Purpose<select name="kind" value={kind} onChange={(event) => setKind(event.target.value as StorageAssetKind)}>
          {UPLOAD_OPTIONS.map((option) => <option key={option.kind} value={option.kind}>{option.label}</option>)}</select></label>
        <label>File<input name="file" type="file" required accept={kind === 'brand_image' ? 'image/jpeg,image/png,image/webp' : undefined} /></label>
        <p className="storage-file-note">{selectedOption.note}</p>
        <button className="button" type="submit" disabled={pending}><Icon name="upload" size={16} />{pending ? 'Storing…' : 'Store file'}</button>
      </form>
      <p className="storage-action-message" aria-live="polite">{message}</p>
    </section>

    <section className="card storage-inventory" aria-labelledby="storage-inventory-title">
      <header><div><p className="eyebrow">Verified inventory</p><h2 id="storage-inventory-title">{initial.assets.length} registry-backed assets · {formatStorageBytes(initial.totalBytes)}</h2></div></header>
      <div className="storage-toolbar">
        <label className="storage-search"><span>Search assets</span><Icon name="search" size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="File name or source" /></label>
        <label><span>Bucket</span><select value={bucket} onChange={(event) => setBucket(event.target.value as BucketFilter)}><option value="all">All buckets</option>
          {initial.buckets.map((entry) => <option key={entry.bucketId} value={entry.bucketId}>{entry.label}</option>)}</select></label>
      </div>
      <p className="storage-results" aria-live="polite">{assets.length} {assets.length === 1 ? 'asset' : 'assets'} shown</p>
      {assets.length === 0 ? <div className="storage-empty"><Icon name="folder" size={23} /><strong>No managed assets match this view.</strong><span>Storage uses records, not placeholder folders. Add a file only when it has a purpose.</span></div> :
        <div className="storage-table-scroll"><table className="storage-table"><thead><tr><th>File</th><th>Purpose</th><th>Source</th><th>Access</th><th>Size</th><th>Added</th><th><span className="sr-only">Download</span></th></tr></thead>
          <tbody>{assets.map((asset) => <tr key={asset.id}><td data-label="File"><strong>{asset.originalFilename}</strong><small>{asset.bucketId} · {asset.mimeType}</small></td><td data-label="Purpose">{KIND_LABEL[asset.kind]}</td><td data-label="Source">{sourceLabel(asset)}</td><td data-label="Access"><span className={`storage-access ${asset.visibility}`}>{asset.visibility}</span></td><td data-label="Size">{asset.byteLabel}</td><td data-label="Added">{dateLabel(asset.createdAt)}</td><td data-label="Download"><button className="button button-secondary storage-download" type="button" onClick={() => download(asset)} disabled={pending}><Icon name="external" size={15} />{downloadingId === asset.id ? 'Opening…' : 'Open'}</button></td></tr>)}</tbody>
        </table></div>}
    </section>
  </div>;
}

function sourceLabel(asset: StorageAssetView): string {
  if (asset.sourceType === 'unassigned') return 'Unassigned';
  return `${asset.sourceType.replace(/_/g, ' ')}${asset.sourceKey ? ` · ${asset.sourceKey}` : ''}`;
}

function dateLabel(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? 'Unknown' : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(date);
}
