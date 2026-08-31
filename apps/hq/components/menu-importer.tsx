'use client';

import Link from 'next/link';
import { useActionState } from 'react';

import {
  extractMenuAction,
  importMenuAction,
  type MenuExtractionState,
} from '@/app/(console)/menu/actions';

const IDLE: MenuExtractionState = { kind: 'idle' };

export function MenuImporter({ sample }: { sample: string }) {
  const [extraction, extract, extracting] = useActionState(extractMenuAction, IDLE);
  const csv = extraction.kind === 'ready' ? extraction.csv : sample;
  return (
    <>
      <div className="card">
        <h2>Transcribe a PDF or photo</h2>
        <p className="subtitle">The source is converted into a draft only. Review every item and price before import.</p>
        {extraction.kind === 'error' ? <div className="notice danger" role="alert">{extraction.message}</div> : null}
        <form action={extract} className="location-form">
          <label className="field">Menu file
            <input accept="application/pdf,image/jpeg,image/png,image/webp" name="menuFile" required type="file" />
          </label>
          <button className="button secondary" disabled={extracting} type="submit">
            {extracting ? 'Transcribing…' : 'Prepare review draft'}
          </button>
        </form>
      </div>
      <div className="card">
        <h2>Review and import</h2>
        <form action={importMenuAction} className="location-form">
          <label className="field">Menu CSV
            <textarea key={csv} name="csv" rows={12} required defaultValue={csv} spellCheck={false} className="menu-csv-input" />
          </label>
          <div className="location-form-actions">
            <Link href="/menu" className="button secondary">Cancel</Link>
            <button type="submit" className="button">Import reviewed menu</button>
          </div>
        </form>
      </div>
    </>
  );
}
