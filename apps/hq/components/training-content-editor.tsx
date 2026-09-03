'use client';

import { useState, useTransition } from 'react';

import { isCoreTrainingTrack, TRAINING_TRACK_ORDER, type TrainingManifest } from '@platform/domain';

import { publishTrainingDraft, saveTrainingDraft } from '@/app/(console)/content/actions';
import { trainingTrackArtworkUrl, type ContentMediaVersion, type TrainingAutomationRun, type TrainingReleaseEditor } from '@/lib/content-model';
import type { TenantTrainingProfile } from '@/lib/training-bootstrap';

import { ContentIcon } from './content-workspace';
import { ManagedThumbnail } from './managed-thumbnail';
import { emptyTrack, TrackEditor } from './training-track-editor';
import { AutomationEditor, SourcesEditor } from './training-sources-editor';

type TrainingView = { kind: 'track'; index: number } | { kind: 'sources' } | { kind: 'automation' };

export function TrainingContentEditor({
  initialRelease,
  initialProfile,
  automationRun,
  trainingMediaVersions,
  readOnly = false,
}: {
  initialRelease: TrainingReleaseEditor;
  initialProfile: TenantTrainingProfile;
  automationRun: TrainingAutomationRun;
  trainingMediaVersions: ContentMediaVersion[];
  readOnly?: boolean;
}) {
  const [manifest, setManifest] = useState(initialRelease.manifest);
  const [release, setRelease] = useState(initialRelease);
  const [view, setView] = useState<TrainingView>({ kind: 'track', index: 0 });
  const [dirty, setDirty] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const activeTrack = view.kind === 'track' ? manifest.tracks[view.index] : null;

  function change(next: TrainingManifest) {
    setManifest(next);
    setDirty(true);
    setMessage(null);
  }

  function save() {
    startTransition(async () => {
      const result = await saveTrainingDraft(manifest, release.status === 'draft' ? release.updatedAt : null);
      if (!result.ok) {
        setMessage(result.error);
        return;
      }
      setRelease((current) => ({ ...current, id: result.releaseId, version: result.version, status: 'draft', updatedAt: result.updatedAt }));
      setDirty(false);
      setMessage(result.persisted ? `Draft v${result.version} saved. Staff still see the published release.` : 'Preview draft saved. Connect Supabase to persist it.');
    });
  }

  function publish() {
    const releaseId = release.id;
    if (!releaseId) return;
    startTransition(async () => {
      const result = await publishTrainingDraft(releaseId, release.updatedAt);
      if (!result.ok) {
        setMessage(result.error);
        return;
      }
      setRelease((current) => ({ ...current, status: 'published' }));
      setMessage(result.persisted ? `Training v${result.version} is live for operators.` : 'Preview release published.');
    });
  }

  return (
    <div className="content-editor-grid training-editor-grid">
      <aside className="content-rail" aria-label="Training content">
        <div className="content-rail-header"><div><strong>Training tracks</strong><span>{manifest.tracks.length} tracks</span></div><span className={`pill ${release.status === 'published' ? 'success' : 'warning'}`}>{release.status}</span></div>
        <div className="training-track-rail" role="tablist" aria-label="Core training tracks">
          {TRAINING_TRACK_ORDER.map((slug) => {
            // One lookup, not two: the slug is the track's only key now, and a
            // core track is guaranteed to exist by normalizeTrainingManifest.
            const index = manifest.tracks.findIndex((track) => track.slug === slug);
            return <button type="button" role="tab" aria-selected={view.kind === 'track' && view.index === index} disabled={index < 0} key={slug} onClick={() => setView({ kind: 'track', index })}>{slug.charAt(0).toUpperCase() + slug.slice(1)}</button>;
          })}
        </div>
        <div className="training-nav-list">
          {manifest.tracks.map((track, index) => (
            <button type="button" key={`${track.slug}-${index}`} className={view.kind === 'track' && view.index === index ? 'active' : ''} onClick={() => setView({ kind: 'track', index })}>
              <ManagedThumbnail url={trainingTrackArtworkUrl(track)} alt={`${track.title} track artwork`} />
              <span><strong>{track.title || 'Untitled track'}</strong><small>{isCoreTrainingTrack(track.slug) ? 'Core track' : 'Tenant track'} · {track.lessons.length} lessons</small></span>
            </button>
          ))}
          <button type="button" className="content-add-button compact" disabled={readOnly} onClick={() => {
            change({ ...manifest, tracks: [...manifest.tracks, emptyTrack(`Track ${manifest.tracks.length + 1}`, manifest.tracks.length)] });
            setView({ kind: 'track', index: manifest.tracks.length });
          }}><ContentIcon kind="plus" /> Add track</button>
        </div>
        <div className="training-nav-secondary">
          <button type="button" className={view.kind === 'sources' ? 'active' : ''} onClick={() => setView({ kind: 'sources' })}><ContentIcon kind="book" /><span><strong>Sources &amp; media</strong><small>{manifest.sources.length} verified links</small></span></button>
          <button type="button" className={view.kind === 'automation' ? 'active' : ''} onClick={() => setView({ kind: 'automation' })}><ContentIcon kind="spark" /><span><strong>Research automation</strong><small>{automationRun?.status ?? 'Ready to run'}</small></span></button>
        </div>
      </aside>

      <div className="content-editor-panel">
        <div className="content-panel-toolbar">
          <div><p className="eyebrow">Tenant-wide curriculum</p><h2>{viewTitle(view, manifest)}</h2></div>
          <div className="content-toolbar-actions">
            {!readOnly ? <><button type="button" className="button secondary content-square-button" disabled={pending || !dirty} onClick={save}>{pending ? 'Saving…' : 'Save draft'}</button>
            <button type="button" className="button content-square-button" disabled={pending || dirty || release.status !== 'draft' || !release.id} onClick={publish}>Publish to operators</button></> : <span className="content-muted">Published release · read only</span>}
          </div>
        </div>
        <fieldset disabled={readOnly} className="content-fieldset-reset">
        {view.kind === 'track' && activeTrack
          ? <TrackEditor key={view.index} track={activeTrack} mediaVersions={trainingMediaVersions} onChange={(track) => change({ ...manifest, tracks: manifest.tracks.map((current, index) => index === view.index ? track : current) })} onRemove={() => {
            change({ ...manifest, tracks: manifest.tracks.filter((_, index) => index !== view.index) });
            setView({ kind: 'track', index: Math.max(0, view.index - 1) });
          }} />
          : null}
        {view.kind === 'sources' ? <SourcesEditor sources={manifest.sources} onChange={(sources) => change({ ...manifest, sources })} /> : null}
        {view.kind === 'automation' ? <AutomationEditor initialProfile={initialProfile} run={automationRun} /> : null}
        </fieldset>
        {message ? <p className="content-message" role="status">{message}</p> : null}
      </div>
    </div>
  );
}

function viewTitle(view: TrainingView, manifest: TrainingManifest): string {
  if (view.kind === 'sources') return 'Sources & media';
  if (view.kind === 'automation') return 'Research automation';
  return manifest.tracks[view.index]?.title || 'Training track';
}
