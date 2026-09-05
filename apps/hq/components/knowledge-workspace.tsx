'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import type { KnowledgeActionState } from '@/lib/knowledge-action-state';
import { Icon } from '@/components/icon';
import type { KnowledgeDocument, KnowledgeWorkspace as Workspace } from '@/lib/knowledge-model';

import { KnowledgeAction } from './knowledge-action';

const KIND_LABEL: Record<KnowledgeDocument['kind'], string> = {
  sop: 'SOP', safety_manual: 'Safety manual',
  project_standard: 'Project standard', project_document: 'Project document',
};

const STATUS_LABEL: Record<KnowledgeDocument['status'], string> = {
  draft: 'Draft', in_review: 'In review', approved: 'Approved', retired: 'Retired',
};

const includes = (document: KnowledgeDocument, query: string): boolean => [
  document.code, document.title, document.summary, document.owner,
  document.project ?? '', ...document.tags, ...document.roles,
].join(' ').toLocaleLowerCase().includes(query.toLocaleLowerCase());

export function KnowledgeWorkspace({ initial }: { readonly initial: Workspace }) {
  const [documents, setDocuments] = useState(initial.documents);
  const [selectedId, setSelectedId] = useState(initial.documents[0]?.id ?? '');
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState('all');
  const [status, setStatus] = useState('all');
  const [location, setLocation] = useState(initial.locationId ?? 'all');
  useEffect(() => setDocuments(initial.documents), [initial.documents]);
  const filtered = useMemo(() => documents.filter((document) => (
    (!query.trim() || includes(document, query.trim()))
    && (kind === 'all' || document.kind === kind)
    && (status === 'all' || document.status === status)
    && (location === 'all' || !document.locationIds.length || document.locationIds.includes(location))
  )), [documents, kind, location, query, status]);
  const selected = filtered.find((document) => document.id === selectedId) ?? filtered[0];
  const pending = documents.filter((document) => document.status === 'in_review').length;
  const acknowledged = documents.reduce((total, document) => total + document.acknowledgementCount, 0);
  const required = documents.reduce((total, document) => total + document.requiredAcknowledgements, 0);
  const currentUserReads = documents.filter((document) => document.acknowledgedByCurrentUser).length;

  const resolveAction = useCallback((state: KnowledgeActionState) => {
    if (state.kind !== 'success' || !state.resourceId) return;
    setDocuments((current) => current.map((document) => {
      if (document.id !== state.resourceId) return document;
      const newlyAcknowledged = state.acknowledged && !document.acknowledgedByCurrentUser;
      return {
        ...document,
        status: state.status ?? document.status,
        acknowledgedByCurrentUser: state.acknowledged ?? document.acknowledgedByCurrentUser,
        acknowledgementCount: document.acknowledgementCount + (newlyAcknowledged ? 1 : 0),
      };
    }));
  }, []);

  return (
    <div className="knowledge-workspace">
      <header className="knowledge-header">
        <div><p className="eyebrow">Controlled field knowledge</p><h1>Knowledge library</h1>
          <p>Versioned standards, safety guidance, and project documents for {initial.tenantName}.</p></div>
        <span className="knowledge-source">{initial.source === 'live' ? 'Tenant data' : 'Preview data'}</span>
      </header>
      <section className="knowledge-metrics" aria-label="Knowledge summary">
        <Metric label="Controlled documents" value={documents.length} detail="Across every active project" />
        {initial.canManage
          ? <Metric label="Awaiting approval" value={pending} detail="Owner review queue" />
          : <Metric label="Available reads" value={documents.length} detail="Approved for your role" />}
        {initial.canManage
          ? <Metric label="Acknowledgements" value={`${acknowledged}/${required}`} detail="Required reads recorded" />
          : <Metric label="Your reads" value={`${currentUserReads}/${documents.length}`} detail="Acknowledgements recorded" />}
      </section>
      <section className="knowledge-library" aria-label="Document library">
        <div className="knowledge-toolbar">
          <label className="knowledge-search"><span>Search documents</span><Icon name="search" size={15} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Code, title, project, or tag" /></label>
          <Filter label="Type" value={kind} onChange={setKind} options={[
            ['all', 'All types'], ...Object.entries(KIND_LABEL),
          ]} />
          <Filter label="Status" value={status} onChange={setStatus} options={[
            ['all', 'All statuses'], ...Object.entries(STATUS_LABEL),
          ]} />
          <Filter label="Location" value={location} onChange={setLocation} options={[
            ['all', 'All locations'], ...initial.locations.map((item) => [item.id, item.name]),
          ]} />
        </div>
        <div className="knowledge-grid">
          <div className="knowledge-list" aria-label={`${filtered.length} matching documents`}>
            {filtered.map((document) => (
              <button key={document.id} type="button" data-selected={document.id === selected?.id || undefined}
                onClick={() => setSelectedId(document.id)}>
                <span><b>{document.code}</b><em data-status={document.status}>{STATUS_LABEL[document.status]}</em></span>
                <strong>{document.title}</strong><small>{KIND_LABEL[document.kind]} · v{document.version}</small>
              </button>
            ))}
            {!filtered.length ? <p className="knowledge-empty">No documents match these filters.</p> : null}
          </div>
          {selected ? <DocumentPanel key={selected.id} document={selected}
            canManage={initial.canManage} source={initial.source} onResolved={resolveAction} /> : (
            <div className="knowledge-detail knowledge-empty">Select a document to inspect its controlled version.</div>
          )}
        </div>
      </section>
    </div>
  );
}

function Metric({ label, value, detail }: { label: string; value: number | string; detail: string }) {
  return <article><span>{label}</span><strong>{value}</strong><small>{detail}</small></article>;
}

function Filter({ label, value, onChange, options }: {
  label: string; value: string; onChange: (value: string) => void; options: readonly (readonly string[])[];
}) {
  return <label><span>{label}</span><select value={value} onChange={(event) => onChange(event.target.value)}>
    {options.map(([option, name]) => <option key={option} value={option}>{name}</option>)}
  </select></label>;
}

function DocumentPanel({ document, canManage, source, onResolved }: {
  document: KnowledgeDocument; canManage: boolean;
  source: Workspace['source']; onResolved: (state: KnowledgeActionState) => void;
}) {
  return <article className="knowledge-detail">
    <div className="knowledge-detail-title"><div><p>{KIND_LABEL[document.kind]} · {document.code}</p><h2>{document.title}</h2></div>
      <span data-status={document.status}>{STATUS_LABEL[document.status]}</span></div>
    <p className="knowledge-summary">{document.summary}</p>
    <dl><div><dt>Controlled version</dt><dd>v{document.version}</dd></div><div><dt>Owner</dt><dd>{document.owner}</dd></div>
      <div><dt>Project</dt><dd>{document.project ?? 'Organization-wide'}</dd></div><div><dt>Updated</dt><dd>{new Date(document.updatedAt).toLocaleDateString()}</dd></div></dl>
    <TargetGroup label="Role targeting" values={document.roles} empty="All project roles" />
    <TargetGroup label="Location targeting" values={document.locationNames} empty="All locations" />
    <div className="knowledge-ack"><span>{canManage ? 'Acknowledgements' : 'Your acknowledgement'}</span>
      <strong>{canManage
        ? `${document.acknowledgementCount} of ${document.requiredAcknowledgements}`
        : document.acknowledgedByCurrentUser ? 'Recorded' : 'Required'}</strong>
      {canManage ? <progress value={document.acknowledgementCount}
        max={Math.max(document.requiredAcknowledgements, 1)} /> : null}</div>
    <div className="knowledge-detail-actions">
      {document.externalHref ? <a className="button secondary" href={document.externalHref} target="_blank" rel="noreferrer">Open source</a> : null}
      <KnowledgeAction document={document} canManage={canManage}
        source={source} onResolved={onResolved} />
    </div>
  </article>;
}

function TargetGroup({ label, values, empty }: { label: string; values: readonly string[]; empty: string }) {
  return <div className="knowledge-targets"><span>{label}</span><div>{values.length
    ? values.map((value) => <small key={value}>{value}</small>) : <small>{empty}</small>}</div></div>;
}
