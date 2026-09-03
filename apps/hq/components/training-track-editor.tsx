'use client';

import { useRef, useState } from 'react';

import { isCoreTrainingTrack, type TrainingLesson, type TrainingTrack } from '@platform/domain';

import { uploadContentImage } from '@/app/(console)/content/actions';
import { slugFromLabel, trainingTrackArtworkUrl, type ContentMediaVersion } from '@/lib/content-model';

import { ContentIcon } from './content-workspace';
import { ManagedThumbnail } from './managed-thumbnail';
import { LessonEditor } from './training-lesson-editor';

/**
 * A new track is a tenant track: its slug comes from the title the author
 * typed, and any slug outside TRAINING_TRACK_ORDER is a tenant track by
 * definition. There is no separate track field to pick -- the slug is the key
 * a member's progress rows will be filed under, so it is the only thing that
 * can decide which track this is.
 */
export function emptyTrack(title: string, sortOrder: number): TrainingTrack {
  return {
    slug: slugFromLabel(title), sortOrder, title, summary: '',
    icon: { symbol: 'book-open', prompt: 'Simple monochrome training icon' }, lessons: [],
  };
}

function emptyLesson(number: number): TrainingLesson {
  return {
    slug: `lesson-${number}`, title: `Lesson ${number}`, objective: '', content: '', estimatedMinutes: 5,
    sourceUrls: [], media: [], quiz: [],
  };
}

export function TrackEditor({ track, mediaVersions, onChange, onRemove }: { track: TrainingTrack; mediaVersions: ContentMediaVersion[]; onChange: (track: TrainingTrack) => void; onRemove: () => void }) {
  const [lessonIndex, setLessonIndex] = useState<number | null>(track.lessons.length ? 0 : null);
  const patch = (next: Partial<TrainingTrack>) => onChange({ ...track, ...next });
  const lesson = lessonIndex === null ? null : track.lessons[lessonIndex] ?? null;
  const core = isCoreTrainingTrack(track.slug);
  return (
    <div className="training-track-editor">
      <div className="content-form-fields training-track-fields">
        <div className="content-inline-fields">
          <label className="field">Track title<input value={track.title} onChange={(event) => patch({ title: event.target.value })} /></label>
          {/* A core track's slug is reserved: renaming it would orphan every
              progress row and competency award already filed under it. */}
          <label className="field">Portable slug<input value={track.slug} readOnly={core} onChange={(event) => patch({ slug: slugFromLabel(event.target.value) })} /></label>
        </div>
        <p className="content-muted">{core ? 'Core track. Its slug is fixed so published progress keeps pointing at it.' : 'Tenant track. It appears after the five core tracks on every operator device.'}</p>
        <TrackIconEditor track={track} history={mediaVersions.filter((version) => version.entityKey === track.slug && version.slot === 'icon')} onChange={patch} />
        <label className="field">Summary<textarea rows={2} value={track.summary} onChange={(event) => patch({ summary: event.target.value })} /></label>
        <div className="content-inline-fields">
          <label className="field">Icon key<input value={track.icon.symbol} onChange={(event) => patch({ icon: { ...track.icon, symbol: slugFromLabel(event.target.value) } })} /></label>
          <label className="field">Icon art direction<input value={track.icon.prompt} onChange={(event) => patch({ icon: { ...track.icon, prompt: event.target.value } })} /></label>
        </div>
      </div>
      <div className="training-lessons-heading"><div><p className="eyebrow">Lessons</p><h3>{track.lessons.length} in this track</h3></div><button type="button" className="button secondary content-square-button" onClick={() => {
        const next = emptyLesson(track.lessons.length + 1);
        patch({ lessons: [...track.lessons, next] });
        setLessonIndex(track.lessons.length);
      }}><ContentIcon kind="plus" /> Add lesson</button></div>
      <div className="training-lesson-tabs" role="tablist" aria-label={`${track.title} lessons`}>
        {track.lessons.map((item, index) => <button type="button" role="tab" aria-selected={lessonIndex === index} className={lessonIndex === index ? 'active' : ''} key={`${item.slug}-${index}`} onClick={() => setLessonIndex(index)}>{index + 1}. {item.title}</button>)}
      </div>
      {lesson && lessonIndex !== null ? <LessonEditor trackSlug={track.slug} lesson={lesson} mediaVersions={mediaVersions} onChange={(next) => patch({ lessons: track.lessons.map((current, index) => index === lessonIndex ? next : current) })} onRemove={() => {
        patch({ lessons: track.lessons.filter((_, index) => index !== lessonIndex) });
        setLessonIndex(track.lessons.length > 1 ? Math.max(0, lessonIndex - 1) : null);
      }} /> : <div className="content-empty compact">Add a lesson to start building this track.</div>}
      <button type="button" className="content-danger-button" onClick={onRemove}>Remove track from draft</button>
    </div>
  );
}

function TrackIconEditor({ track, history, onChange }: { track: TrainingTrack; history: ContentMediaVersion[]; onChange: (next: Partial<TrainingTrack>) => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const previewUrl = trainingTrackArtworkUrl(track);
  async function upload(file: File) {
    setUploading(true);
    const payload = new FormData();
    payload.set('family', 'training');
    // 'training-module' is the storage scope literal, which maps to the
    // content-media `entity_type` of the same name. That is a schema string
    // shared with the catalog tables, not this manifest's vocabulary.
    payload.set('scope', 'training-module');
    payload.set('entityKey', track.slug);
    payload.set('file', file);
    const result = await uploadContentImage(payload);
    if (result.ok) onChange({ icon: { ...track.icon, url: result.url || URL.createObjectURL(file) } });
    setUploading(false);
  }
  return (
    <div className="training-icon-editor">
      <ManagedThumbnail url={previewUrl} alt={`${track.title} track artwork`} />
      <div><strong>Track artwork</strong><small>Optional tenant-owned icon stored with the training release.</small></div>
      <input ref={fileRef} className="sr-only" type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => { const file = event.target.files?.[0]; if (file) void upload(file); }} />
      <button type="button" className="button secondary content-square-button" disabled={uploading} onClick={() => fileRef.current?.click()}><ContentIcon kind="upload" /> {uploading ? 'Uploading…' : track.icon.url ? 'Replace artwork' : 'Upload artwork'}</button>
      {history.length > 0 ? <div className="content-media-history"><strong>Artwork history</strong><div className="content-media-history-grid">{history.slice(0, 8).map((version) => <button type="button" key={version.id} className={track.icon.url === version.url ? 'active' : ''} aria-label={`Use artwork from ${new Date(version.createdAt).toLocaleString()}`} onClick={() => onChange({ icon: { ...track.icon, url: version.url } })}><ManagedThumbnail url={version.url} alt={`Artwork from ${new Date(version.createdAt).toLocaleDateString()}`} className="content-history-thumb" /><time dateTime={version.createdAt}>{new Date(version.createdAt).toLocaleDateString()}</time></button>)}</div></div> : null}
    </div>
  );
}
