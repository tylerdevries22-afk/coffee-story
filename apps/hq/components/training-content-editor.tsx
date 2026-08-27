'use client';

import { useRef, useState, useTransition } from 'react';

import { TRAINING_TRACK_ORDER, type TrainingLesson, type TrainingManifest, type TrainingModule, type TrainingSource, type TrainingTrackKey } from '@platform/domain';

import {
  publishTrainingDraft,
  saveTrainingDraft,
  startTrainingAutomation,
  uploadContentImage,
} from '@/app/(console)/content/actions';
import { slugFromLabel, type ContentMediaVersion, type TrainingAutomationRun, type TrainingReleaseEditor } from '@/lib/content-model';
import type { TenantTrainingProfile } from '@/lib/training-bootstrap';

import { ContentIcon } from './content-workspace';
import { ManagedThumbnail } from './managed-thumbnail';

type TrainingView = { kind: 'module'; index: number } | { kind: 'sources' } | { kind: 'automation' };

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
  const [view, setView] = useState<TrainingView>({ kind: 'module', index: 0 });
  const [dirty, setDirty] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const activeModule = view.kind === 'module' ? manifest.modules[view.index] : null;

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
        <div className="content-rail-header"><div><strong>Training tracks</strong><span>{manifest.modules.length} modules</span></div><span className={`pill ${release.status === 'published' ? 'success' : 'warning'}`}>{release.status}</span></div>
        <div className="training-track-rail" role="tablist" aria-label="Core training tracks">
          {TRAINING_TRACK_ORDER.map((trackKey) => {
            const index = manifest.modules.findIndex((module) => module.trackKey === trackKey || module.slug === trackKey);
            return <button type="button" role="tab" aria-selected={view.kind === 'module' && view.index === index} disabled={index < 0} key={trackKey} onClick={() => setView({ kind: 'module', index })}>{trackKey.charAt(0).toUpperCase() + trackKey.slice(1)}</button>;
          })}
        </div>
        <div className="training-nav-list">
          {manifest.modules.map((module, index) => (
            <button type="button" key={`${module.slug}-${index}`} className={view.kind === 'module' && view.index === index ? 'active' : ''} onClick={() => setView({ kind: 'module', index })}>
              <ManagedThumbnail url={moduleArtworkUrl(module)} alt={`${module.title} module artwork`} />
              <span><strong>{module.title || 'Untitled module'}</strong><small>{module.trackKey ?? 'custom'} · {module.lessons.length} lessons</small></span>
            </button>
          ))}
          <button type="button" className="content-add-button compact" disabled={readOnly} onClick={() => {
            const title = `Module ${manifest.modules.length + 1}`;
            change({ ...manifest, modules: [...manifest.modules, emptyModule(title, manifest.modules.length)] });
            setView({ kind: 'module', index: manifest.modules.length });
          }}><ContentIcon kind="plus" /> Add module</button>
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
        {view.kind === 'module' && activeModule
          ? <ModuleEditor key={view.index} module={activeModule} mediaVersions={trainingMediaVersions} onChange={(module) => change({ ...manifest, modules: manifest.modules.map((current, index) => index === view.index ? module : current) })} onRemove={() => {
            change({ ...manifest, modules: manifest.modules.filter((_, index) => index !== view.index) });
            setView({ kind: 'module', index: Math.max(0, view.index - 1) });
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
  return manifest.modules[view.index]?.title || 'Training module';
}

function emptyModule(title: string, sortOrder: number): TrainingModule {
  return {
    slug: slugFromLabel(title), trackKey: 'custom', sortOrder, title, summary: '',
    icon: { symbol: 'book-open', prompt: 'Simple monochrome training icon' }, lessons: [],
  };
}

function emptyLesson(number: number): TrainingLesson {
  return {
    slug: `lesson-${number}`, title: `Lesson ${number}`, objective: '', content: '', estimatedMinutes: 5,
    sourceUrls: [], media: [], quiz: [],
  };
}

function ModuleEditor({ module, mediaVersions, onChange, onRemove }: { module: TrainingModule; mediaVersions: ContentMediaVersion[]; onChange: (module: TrainingModule) => void; onRemove: () => void }) {
  const [lessonIndex, setLessonIndex] = useState<number | null>(module.lessons.length ? 0 : null);
  const patch = (next: Partial<TrainingModule>) => onChange({ ...module, ...next });
  const lesson = lessonIndex === null ? null : module.lessons[lessonIndex] ?? null;
  return (
    <div className="training-module-editor">
      <div className="content-form-fields training-module-fields">
        <div className="content-inline-fields">
          <label className="field">Module title<input value={module.title} onChange={(event) => patch({ title: event.target.value })} /></label>
          <label className="field">Portable slug<input value={module.slug} onChange={(event) => patch({ slug: slugFromLabel(event.target.value) })} /></label>
        </div>
        <label className="field">Track<select value={module.trackKey ?? 'custom'} onChange={(event) => patch({ trackKey: event.target.value as TrainingTrackKey })}>{TRAINING_TRACK_ORDER.map((track) => <option key={track} value={track}>{track.charAt(0).toUpperCase() + track.slice(1)}</option>)}<option value="custom">Custom module</option></select></label>
        <ModuleIconEditor module={module} history={mediaVersions.filter((version) => version.entityKey === module.slug && version.slot === 'icon')} onChange={patch} />
        <label className="field">Summary<textarea rows={2} value={module.summary} onChange={(event) => patch({ summary: event.target.value })} /></label>
        <div className="content-inline-fields">
          <label className="field">Icon key<input value={module.icon.symbol} onChange={(event) => patch({ icon: { ...module.icon, symbol: slugFromLabel(event.target.value) } })} /></label>
          <label className="field">Icon art direction<input value={module.icon.prompt} onChange={(event) => patch({ icon: { ...module.icon, prompt: event.target.value } })} /></label>
        </div>
      </div>
      <div className="training-lessons-heading"><div><p className="eyebrow">Lessons</p><h3>{module.lessons.length} in this module</h3></div><button type="button" className="button secondary content-square-button" onClick={() => {
        const next = emptyLesson(module.lessons.length + 1);
        patch({ lessons: [...module.lessons, next] });
        setLessonIndex(module.lessons.length);
      }}><ContentIcon kind="plus" /> Add lesson</button></div>
      <div className="training-lesson-tabs" role="tablist" aria-label={`${module.title} lessons`}>
        {module.lessons.map((item, index) => <button type="button" role="tab" aria-selected={lessonIndex === index} className={lessonIndex === index ? 'active' : ''} key={`${item.slug}-${index}`} onClick={() => setLessonIndex(index)}>{index + 1}. {item.title}</button>)}
      </div>
      {lesson && lessonIndex !== null ? <LessonEditor moduleSlug={module.slug} lesson={lesson} mediaVersions={mediaVersions} onChange={(next) => patch({ lessons: module.lessons.map((current, index) => index === lessonIndex ? next : current) })} onRemove={() => {
        patch({ lessons: module.lessons.filter((_, index) => index !== lessonIndex) });
        setLessonIndex(module.lessons.length > 1 ? Math.max(0, lessonIndex - 1) : null);
      }} /> : <div className="content-empty compact">Add a lesson to start building this module.</div>}
      <button type="button" className="content-danger-button" onClick={onRemove}>Remove module from draft</button>
    </div>
  );
}

function ModuleIconEditor({ module, history, onChange }: { module: TrainingModule; history: ContentMediaVersion[]; onChange: (next: Partial<TrainingModule>) => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const previewUrl = moduleArtworkUrl(module);
  async function upload(file: File) {
    setUploading(true);
    const payload = new FormData();
    payload.set('family', 'training');
    payload.set('scope', 'training-module');
    payload.set('entityKey', module.slug);
    payload.set('file', file);
    const result = await uploadContentImage(payload);
    if (result.ok) onChange({ icon: { ...module.icon, url: result.url || URL.createObjectURL(file) } });
    setUploading(false);
  }
  return (
    <div className="training-icon-editor">
      <ManagedThumbnail url={previewUrl} alt={`${module.title} module artwork`} />
      <div><strong>Module artwork</strong><small>Optional tenant-owned icon stored with the training release.</small></div>
      <input ref={fileRef} className="sr-only" type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => { const file = event.target.files?.[0]; if (file) void upload(file); }} />
      <button type="button" className="button secondary content-square-button" disabled={uploading} onClick={() => fileRef.current?.click()}><ContentIcon kind="upload" /> {uploading ? 'Uploading…' : module.icon.url ? 'Replace artwork' : 'Upload artwork'}</button>
      {history.length > 0 ? <div className="content-media-history"><strong>Artwork history</strong><div className="content-media-history-grid">{history.slice(0, 8).map((version) => <button type="button" key={version.id} className={module.icon.url === version.url ? 'active' : ''} aria-label={`Use artwork from ${new Date(version.createdAt).toLocaleString()}`} onClick={() => onChange({ icon: { ...module.icon, url: version.url } })}><ManagedThumbnail url={version.url} alt={`Artwork from ${new Date(version.createdAt).toLocaleDateString()}`} className="content-history-thumb" /><time dateTime={version.createdAt}>{new Date(version.createdAt).toLocaleDateString()}</time></button>)}</div></div> : null}
    </div>
  );
}

function moduleArtworkUrl(module: TrainingModule): string | undefined {
  if (module.icon.url) return module.icon.url;
  return module.trackKey && TRAINING_TRACK_ORDER.includes(module.trackKey as (typeof TRAINING_TRACK_ORDER)[number])
    ? `/api/demo-media/training/${module.trackKey}`
    : undefined;
}

function LessonEditor({ moduleSlug, lesson, mediaVersions, onChange, onRemove }: { moduleSlug: string; lesson: TrainingLesson; mediaVersions: ContentMediaVersion[]; onChange: (lesson: TrainingLesson) => void; onRemove: () => void }) {
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
      <MediaEditor entityKey={`${moduleSlug}/${lesson.slug}`} media={lesson.media} history={mediaVersions} onChange={(media) => patch({ media })} />
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

function SourcesEditor({ sources, onChange }: { sources: TrainingSource[]; onChange: (sources: TrainingSource[]) => void }) {
  return (
    <div className="training-sources-editor">
      <div className="content-section-intro"><p>Sources support lesson claims and media rights. Publishing requires at least three public HTTPS sources.</p><button type="button" className="button secondary content-square-button" onClick={() => onChange([...sources, { title: '', url: '', publisher: '', accessedAt: new Date().toISOString().slice(0, 10) }])}><ContentIcon kind="plus" /> Add source</button></div>
      {sources.map((source, index) => <div className="training-source-row" key={index}>
        <span className="training-module-mark">{index + 1}</span>
        <label className="field">Title<input value={source.title} onChange={(event) => onChange(replaceAt(sources, index, { ...source, title: event.target.value }))} /></label>
        <label className="field">Publisher<input value={source.publisher} onChange={(event) => onChange(replaceAt(sources, index, { ...source, publisher: event.target.value }))} /></label>
        <label className="field source-url-field">Public HTTPS URL<input type="url" value={source.url} onChange={(event) => onChange(replaceAt(sources, index, { ...source, url: event.target.value }))} /></label>
        <label className="field">Accessed<input type="date" value={source.accessedAt} onChange={(event) => onChange(replaceAt(sources, index, { ...source, accessedAt: event.target.value }))} /></label>
        <button type="button" className="icon-action danger" aria-label={`Remove source ${index + 1}`} onClick={() => onChange(sources.filter((_, currentIndex) => currentIndex !== index))}>×</button>
      </div>)}
    </div>
  );
}

function AutomationEditor({ initialProfile, run }: { initialProfile: TenantTrainingProfile; run: TrainingAutomationRun }) {
  const [profile, setProfile] = useState(initialProfile);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const patch = (next: Partial<TenantTrainingProfile>) => setProfile((current) => ({ ...current, ...next }));
  return (
    <div className="automation-editor">
      <div className="automation-callout"><span className="content-icon-frame"><ContentIcon kind="spark" /></span><div><h3>Build a researched tenant curriculum</h3><p>The workflow researches authoritative sources, creates portable icons and media links, writes Knowledge and Skills lessons, generates quizzes, verifies public resources, and runs an independent quality review before publishing.</p></div></div>
      {run ? <div className="automation-progress"><div><strong>Latest run: {run.status}</strong><span>{run.stage.replaceAll('_', ' ')}</span></div><div className="progress-track"><i style={{ transform: `scaleX(${run.progress / 100})` }} /></div><b>{run.progress}%</b></div> : null}
      <div className="content-form-fields automation-profile">
        <div className="content-inline-fields"><label className="field">Business name<input value={profile.businessName} onChange={(event) => patch({ businessName: event.target.value })} /></label><label className="field">Industry<input value={profile.industry} onChange={(event) => patch({ industry: event.target.value })} /></label></div>
        <div className="content-inline-fields"><label className="field">Locale<input value={profile.locale} onChange={(event) => patch({ locale: event.target.value })} /></label><label className="field">Website<input type="url" value={profile.website ?? ''} onChange={(event) => patch({ website: event.target.value || undefined })} /></label></div>
        <label className="field">Products <small>Comma separated</small><input value={profile.products?.join(', ') ?? ''} onChange={(event) => patch({ products: commaList(event.target.value) })} /></label>
        <label className="field">Services <small>Comma separated</small><input value={profile.services?.join(', ') ?? ''} onChange={(event) => patch({ services: commaList(event.target.value) })} /></label>
        <label className="field">Compliance topics <small>Comma separated; the workflow will not claim legal certification</small><input value={profile.complianceTopics?.join(', ') ?? ''} onChange={(event) => patch({ complianceTopics: commaList(event.target.value) })} /></label>
        <label className="field">Brand voice<input value={profile.brandVoice ?? ''} onChange={(event) => patch({ brandVoice: event.target.value || undefined })} /></label>
      </div>
      <button type="button" className="button content-square-button" disabled={pending} onClick={() => startTransition(async () => {
        const result = await startTrainingAutomation(profile);
        setMessage(result.ok ? (result.persisted ? `Research run ${result.runId.slice(0, 8)} queued.` : 'Preview research run queued.') : result.error);
      })}><ContentIcon kind="spark" /> {pending ? 'Starting research…' : 'Research and rebuild training'}</button>
      {message ? <p role="status" className="content-message">{message}</p> : null}
    </div>
  );
}

function linesOf(value: string): string[] {
  return value.split('\n').map((line) => line.trim()).filter(Boolean);
}

function commaList(value: string): string[] | undefined {
  const values = value.split(',').map((item) => item.trim()).filter(Boolean);
  return values.length ? values : undefined;
}

function replaceAt<T>(values: T[], index: number, value: T): T[] {
  return values.map((current, currentIndex) => currentIndex === index ? value : current);
}
