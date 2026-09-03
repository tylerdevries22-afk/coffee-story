'use client';

import { useRef, useState } from 'react';

import type { TrainingLesson } from '@platform/domain';

import { uploadContentImage } from '@/app/(console)/content/actions';
import { slugFromLabel, type ContentMediaVersion } from '@/lib/content-model';

import { ContentIcon } from './content-workspace';
import { ManagedThumbnail } from './managed-thumbnail';

export function LessonEditor({ trackSlug, lesson, mediaVersions, onChange, onRemove }: { trackSlug: string; lesson: TrainingLesson; mediaVersions: ContentMediaVersion[]; onChange: (lesson: TrainingLesson) => void; onRemove: () => void }) {
  const patch = (next: Partial<TrainingLesson>) => onChange({ ...lesson, ...next });
  return (
    <div className="training-lesson-editor">
      <div className="content-inline-fields">
        <label className="field">Lesson title<input value={lesson.title} onChange={(event) => patch({ title: event.target.value })} /></label>
        <label className="field">Portable slug<input value={lesson.slug} onChange={(event) => patch({ slug: slugFromLabel(event.target.value) })} /></label>
      </div>
      <div className="content-inline-fields objective-fields">
        <label className="field">Objective<input value={lesson.objective} onChange={(event) => patch({ objective: event.target.value })} /></label>
        <label className="field minutes-field">Minutes<input type="number" min="1" max="90" value={lesson.estimatedMinutes} onChange={(event) => patch({ estimatedMinutes: Number(event.target.value) })} /></label>
      </div>
      <label className="field">Lesson content<textarea className="lesson-content-input" rows={8} value={lesson.content} onChange={(event) => patch({ content: event.target.value })} /></label>
      <label className="field">Source URLs <small>One HTTPS URL per line; every claim should point to a source in Sources &amp; media.</small><textarea rows={3} value={lesson.sourceUrls.join('\n')} onChange={(event) => patch({ sourceUrls: linesOf(event.target.value) })} /></label>
      <label className="field">Linked menu item slugs <small>Optional; keeps training aligned with the customer menu.</small><textarea rows={2} value={lesson.menuItemSlugs?.join('\n') ?? ''} onChange={(event) => patch({ menuItemSlugs: linesOf(event.target.value) })} /></label>
      <MediaEditor entityKey={`${trackSlug}/${lesson.slug}`} media={lesson.media} history={mediaVersions} onChange={(media) => patch({ media })} />
      <QuizEditor quiz={lesson.quiz} onChange={(quiz) => patch({ quiz })} />
      <button type="button" className="content-danger-button" onClick={onRemove}>Remove lesson from draft</button>
    </div>
  );
}

function MediaEditor({ entityKey, media, history, onChange }: { entityKey: string; media: TrainingLesson['media']; history: ContentMediaVersion[]; onChange: (media: TrainingLesson['media']) => void }) {
  return (
    <div className="training-block">
      <div className="training-block-heading"><div><p className="eyebrow">Lesson media</p><h3>Images and video links</h3></div><button type="button" className="content-text-button" onClick={() => onChange([...media, { kind: 'image', url: '', title: '', rightsNote: '' }])}>Add media</button></div>
      {media.map((item, index) => <MediaRow key={`${index}-${item.url}`} entityKey={entityKey} history={history.filter((version) => version.entityKey === entityKey && version.slot === `lesson-media:${index + 1}`)} item={item} onChange={(next) => onChange(media.map((current, currentIndex) => currentIndex === index ? next : current))} onRemove={() => onChange(media.filter((_, currentIndex) => currentIndex !== index))} />)}
      {media.length === 0 ? <p className="content-muted">No media attached. Publisher-hosted video links and tenant-owned images are supported.</p> : null}
    </div>
  );
}

function MediaRow({ entityKey, item, history, onChange, onRemove }: { entityKey: string; item: TrainingLesson['media'][number]; history: ContentMediaVersion[]; onChange: (item: TrainingLesson['media'][number]) => void; onRemove: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  async function upload(file: File) {
    setUploading(true);
    const payload = new FormData();
    payload.set('family', 'training');
    payload.set('scope', 'training-lesson');
    payload.set('entityKey', entityKey);
    payload.set('file', file);
    const result = await uploadContentImage(payload);
    if (result.ok) onChange({ ...item, kind: 'image', url: result.url || URL.createObjectURL(file), title: item.title || file.name.replace(/\.[^.]+$/, '') });
    setUploading(false);
  }
  return (
    <div className="training-media-row">
      <ManagedThumbnail url={item.kind === 'image' ? item.url : null} alt={item.title || 'Lesson media'} className="training-media-preview" />
      <label className="field">Type<select value={item.kind} onChange={(event) => onChange({ ...item, kind: event.target.value as 'image' | 'video' })}><option value="image">Image</option><option value="video">Video</option></select></label>
      <label className="field">Title<input value={item.title} onChange={(event) => onChange({ ...item, title: event.target.value })} /></label>
      <label className="field media-url-field">Public HTTPS URL<input type="url" value={item.url} onChange={(event) => onChange({ ...item, url: event.target.value })} /></label>
      <input ref={fileRef} className="sr-only" type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => { const file = event.target.files?.[0]; if (file) void upload(file); }} />
      <button type="button" className="icon-action" aria-label="Upload training image" disabled={uploading} onClick={() => fileRef.current?.click()}><ContentIcon kind="upload" /></button>
      <label className="field rights-field">Rights note<input value={item.rightsNote} onChange={(event) => onChange({ ...item, rightsNote: event.target.value })} /></label>
      {history.length > 0 ? <div className="content-media-history"><strong>Previous media</strong><div className="content-media-history-grid">{history.slice(0, 8).map((version) => <button type="button" key={version.id} className={item.url === version.url ? 'active' : ''} aria-label={`Use media from ${new Date(version.createdAt).toLocaleString()}`} onClick={() => onChange({ ...item, url: version.url })}><ManagedThumbnail url={version.url} alt={`Media from ${new Date(version.createdAt).toLocaleDateString()}`} className="content-history-thumb" /><time dateTime={version.createdAt}>{new Date(version.createdAt).toLocaleDateString()}</time></button>)}</div></div> : null}
      <button type="button" className="icon-action danger" aria-label="Remove media" onClick={onRemove}>×</button>
    </div>
  );
}

function QuizEditor({ quiz, onChange }: { quiz: TrainingLesson['quiz']; onChange: (quiz: TrainingLesson['quiz']) => void }) {
  return (
    <div className="training-block">
      <div className="training-block-heading"><div><p className="eyebrow">Knowledge check</p><h3>Quiz questions</h3></div><button type="button" className="content-text-button" onClick={() => onChange([...quiz, { prompt: '', choices: ['Option 1', 'Option 2'], correctChoice: 0, explanation: '' }])}>Add question</button></div>
      {quiz.map((question, index) => (
        <div className="training-question" key={index}>
          <div className="training-question-number">{index + 1}</div>
          <label className="field">Question<input value={question.prompt} onChange={(event) => onChange(quiz.map((current, currentIndex) => currentIndex === index ? { ...current, prompt: event.target.value } : current))} /></label>
          <label className="field">Choices <small>One option per line</small><textarea rows={3} value={question.choices.join('\n')} onChange={(event) => {
            const choices = linesOf(event.target.value);
            onChange(quiz.map((current, currentIndex) => currentIndex === index ? { ...current, choices, correctChoice: Math.min(current.correctChoice ?? 0, Math.max(0, choices.length - 1)) } : current));
          }} /></label>
          <label className="field">Correct answer<select value={question.correctChoice ?? ''} onChange={(event) => onChange(quiz.map((current, currentIndex) => currentIndex === index ? { ...current, correctChoice: Number(event.target.value) } : current))}>
            <option value="" disabled>Choose</option>{question.choices.map((choice, choiceIndex) => <option key={choiceIndex} value={choiceIndex}>{choiceIndex + 1}. {choice}</option>)}
          </select></label>
          <label className="field">Explanation<input value={question.explanation} onChange={(event) => onChange(quiz.map((current, currentIndex) => currentIndex === index ? { ...current, explanation: event.target.value } : current))} /></label>
          <button type="button" className="icon-action danger" aria-label={`Remove question ${index + 1}`} onClick={() => onChange(quiz.filter((_, currentIndex) => currentIndex !== index))}>×</button>
        </div>
      ))}
      {quiz.length === 0 ? <p className="content-muted">Add at least two questions before publishing.</p> : null}
    </div>
  );
}

function linesOf(value: string): string[] {
  return value.split('\n').map((line) => line.trim()).filter(Boolean);
}
