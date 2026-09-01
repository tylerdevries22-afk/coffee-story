'use client';

import { useRef, useState } from 'react';

import {
  addCatalogAlias,
  addCatalogResource,
  linkCatalogResource,
  saveCatalogResourceImage,
  uploadContentImage,
} from '@/app/(console)/content/actions';
import { catalogPath } from '@/lib/catalog-insights';
import type {
  ContentCatalogPlacement,
  ContentCatalogRelation,
  ContentCatalogResource,
  ContentCategory,
} from '@/lib/content-model';

import { ManagedThumbnail } from './managed-thumbnail';

type CatalogRelationshipsProps = {
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
};

export function CatalogRelationships(props: CatalogRelationshipsProps) {
  const [kind, setKind] = useState<ContentCatalogResource['kind']>('material');
  const [relationKind, setRelationKind] = useState<ContentCatalogRelation['kind']>('requires');
  const [title, setTitle] = useState('');
  const [summary, setSummary] = useState('');
  const [selectedResource, setSelectedResource] = useState('');
  const [aliasParentId, setAliasParentId] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const linked = props.relations.filter((relation) => relation.sourceId === props.nodeId)
    .map((relation) => ({ relation, resource: props.resources.find((resource) => resource.id === relation.targetId) }))
    .filter((entry): entry is { relation: ContentCatalogRelation; resource: ContentCatalogResource } => Boolean(entry.resource));
  const aliases = props.placements.filter((placement) => placement.nodeId === props.nodeId && !placement.isPrimary);

  async function addAlias() {
    const result = await addCatalogAlias(props.nodeId, aliasParentId);
    if (!result.ok) return setMessage(result.error);
    props.onPlacement(result.placement);
    setAliasParentId('');
    setMessage(result.persisted ? 'Alias added to the catalog draft.' : 'Preview alias added.');
  }

  async function linkResource() {
    const result = await linkCatalogResource(props.nodeId, selectedResource, relationKind);
    if (!result.ok) return setMessage(result.error);
    props.onRelation(result.relation);
    setSelectedResource('');
    setMessage(result.persisted ? 'Resource linked in the catalog draft.' : 'Preview relationship added.');
  }

  async function createResource() {
    const audience = kind === 'material' || kind === 'specification' ? 'public' : 'staff';
    const result = await addCatalogResource(kind, title, summary, audience);
    if (!result.ok) return setMessage(result.error);
    props.onResource(result.resource);
    setSelectedResource(result.resource.id);
    setTitle('');
    setSummary('');
    setMessage(result.persisted ? 'Resource created. Link it to this offering when ready.' : 'Preview resource created.');
  }

  return (
    <section className="catalog-relationships" aria-labelledby="catalog-relationships-title">
      <div className="content-section-intro">
        <div><p className="eyebrow">Connected content graph</p><h3 id="catalog-relationships-title">Materials, procedures, knowledge, skills, and training</h3></div>
        <span className="pill">{linked.length} linked</span>
      </div>
      <div className="catalog-resource-grid">
        {linked.map(({ relation, resource }) => (
          <article key={relation.id} className="catalog-resource-card">
            <ResourceThumbnailEditor resource={resource} onSaved={props.onResourceUpdate} />
            <span>{resource.kind.replace('_', ' ')}</span><strong>{resource.title}</strong>
            <small>{relation.kind} · {resource.audience}</small><p>{resource.summary || 'No summary yet.'}</p>
          </article>
        ))}
        {linked.length === 0 ? <div className="content-empty compact">No linked resources yet. Link an existing resource or create one below.</div> : null}
      </div>
      <div className="catalog-link-builder">
        <label className="field">Alias placement<select value={aliasParentId} onChange={(event) => setAliasParentId(event.target.value)}>
          <option value="">Choose another folder</option>
          {props.categories.map((folder) => <option key={folder.id} value={folder.id}>{catalogPath(props.categories, folder.id)}</option>)}
        </select></label>
        <button type="button" className="button secondary content-square-button" disabled={!aliasParentId} onClick={() => void addAlias()}>Add alias</button>
        <small>{aliases.length > 0 ? aliases.map((alias) => catalogPath(props.categories, alias.parentId ?? '')).join(' · ') : 'No aliases. The offering has one canonical identity.'}</small>
      </div>
      <div className="catalog-link-builder">
        <label className="field">Relationship<select value={relationKind} onChange={(event) => setRelationKind(event.target.value as ContentCatalogRelation['kind'])}>
          {['requires', 'follows', 'teaches', 'develops', 'covers', 'prerequisite', 'related', 'substitute'].map((value) => <option key={value}>{value}</option>)}
        </select></label>
        <label className="field">Existing resource<select value={selectedResource} onChange={(event) => setSelectedResource(event.target.value)}>
          <option value="">Choose a resource</option>
          {props.resources.map((resource) => <option key={resource.id} value={resource.id}>{resource.kind.replace('_', ' ')} · {resource.title}</option>)}
        </select></label>
        <button type="button" className="button secondary content-square-button" disabled={!selectedResource} onClick={() => void linkResource()}>Link resource</button>
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
        <button type="button" className="button secondary content-square-button" disabled={title.trim().length < 2} onClick={() => void createResource()}>Create resource</button>
      </details>
      <button type="button" className="button secondary content-square-button" onClick={props.onArchive}>Archive offering</button>
      {message ? <p className="content-message" role="status">{message}</p> : null}
    </section>
  );
}

function ResourceThumbnailEditor({ resource, onSaved }: { resource: ContentCatalogResource; onSaved: (resource: ContentCatalogResource) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  async function choose(file: File) {
    setBusy(true);
    setMessage(null);
    const payload = new FormData();
    payload.set('family', 'menu');
    payload.set('scope', 'catalog-resource');
    payload.set('entityKey', resource.id);
    payload.set('file', file);
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
    <input ref={inputRef} className="sr-only" type="file" aria-label={`Upload ${resource.title} resource thumbnail file`} accept="image/jpeg,image/png,image/webp" onChange={(event) => {
      const file = event.target.files?.[0];
      if (file) void choose(file);
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
