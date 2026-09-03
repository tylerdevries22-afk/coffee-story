'use client';

import { useState, useTransition } from 'react';

import type { TrainingSource } from '@platform/domain';

import { startTrainingAutomation } from '@/app/(console)/content/actions';
import type { TrainingAutomationRun } from '@/lib/content-model';
import type { TenantTrainingProfile } from '@/lib/training-bootstrap';

import { ContentIcon } from './content-workspace';

export function SourcesEditor({ sources, onChange }: { sources: TrainingSource[]; onChange: (sources: TrainingSource[]) => void }) {
  return (
    <div className="training-sources-editor">
      <div className="content-section-intro"><p>Sources support lesson claims and media rights. Publishing requires at least three public HTTPS sources.</p><button type="button" className="button secondary content-square-button" onClick={() => onChange([...sources, { title: '', url: '', publisher: '', accessedAt: new Date().toISOString().slice(0, 10) }])}><ContentIcon kind="plus" /> Add source</button></div>
      {sources.map((source, index) => <div className="training-source-row" key={index}>
        <span className="training-row-mark">{index + 1}</span>
        <label className="field">Title<input value={source.title} onChange={(event) => onChange(replaceAt(sources, index, { ...source, title: event.target.value }))} /></label>
        <label className="field">Publisher<input value={source.publisher} onChange={(event) => onChange(replaceAt(sources, index, { ...source, publisher: event.target.value }))} /></label>
        <label className="field source-url-field">Public HTTPS URL<input type="url" value={source.url} onChange={(event) => onChange(replaceAt(sources, index, { ...source, url: event.target.value }))} /></label>
        <label className="field">Accessed<input type="date" value={source.accessedAt} onChange={(event) => onChange(replaceAt(sources, index, { ...source, accessedAt: event.target.value }))} /></label>
        <button type="button" className="icon-action danger" aria-label={`Remove source ${index + 1}`} onClick={() => onChange(sources.filter((_, currentIndex) => currentIndex !== index))}>×</button>
      </div>)}
    </div>
  );
}

export function AutomationEditor({ initialProfile, run }: { initialProfile: TenantTrainingProfile; run: TrainingAutomationRun }) {
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

function commaList(value: string): string[] | undefined {
  const values = value.split(',').map((item) => item.trim()).filter(Boolean);
  return values.length ? values : undefined;
}

function replaceAt<T>(values: T[], index: number, value: T): T[] {
  return values.map((current, currentIndex) => currentIndex === index ? value : current);
}
