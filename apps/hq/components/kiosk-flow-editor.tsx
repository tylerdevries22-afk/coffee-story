'use client';

import { useMemo, useState, useTransition } from 'react';
import {
  inspectKioskFlow,
  resolveKioskFlow,
  type KioskEntryNode,
  type KioskMenuFacts,
} from '@platform/domain';

import { saveKioskFlow } from '@/app/(console)/kiosk/actions';
import { KioskFlowPreview } from '@/components/kiosk-flow-preview';
import { KioskFlowEntryEditor } from './kiosk-flow-entry-editor';
import {
  isRecord,
  type KioskDraft,
} from './kiosk-flow-editor-types';
import {
  KioskAttractSettings,
  KioskOrderingSettings,
  KioskTimingSettings,
} from './kiosk-flow-settings';
import { KioskMediaLibrary } from './kiosk-media-library';

/**
 * The preview and devices share the same resolver. Inspection also reports any
 * invalid configuration that a device would ignore before the editor saves it.
 */
export function KioskFlowEditor({
  initial,
  menu,
  updatedAt,
  brandName,
}: {
  initial: unknown;
  menu: KioskMenuFacts;
  updatedAt: string | null;
  brandName?: string;
}) {
  const [draft, setDraft] = useState<KioskDraft>(
    () => (isRecord(initial) ? { ...initial } : {}),
  );
  const [savedAt, setSavedAt] = useState(updatedAt);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const flow = useMemo(() => resolveKioskFlow(draft, { menu }), [draft, menu]);
  const notes = useMemo(() => inspectKioskFlow(draft, { menu }), [draft, menu]);
  const nodes = flow.entry.nodes;

  function patch(next: KioskDraft) {
    setDraft((current) => ({ ...current, ...next }));
    setMessage(null);
  }

  function patchEntry(next: Record<string, unknown>) {
    const entry = isRecord(draft.entry) ? draft.entry : {};
    patch({ entry: { ...entry, ...next } });
  }

  function editableNodes(): KioskEntryNode[] {
    const configured = isRecord(draft.entry) && Array.isArray(draft.entry.nodes)
      ? (draft.entry.nodes as KioskEntryNode[])
      : null;
    return configured ?? nodes.map((node) => ({ ...node }));
  }

  function save() {
    startTransition(async () => {
      const result = await saveKioskFlow(draft, menu, savedAt);
      if (result.ok) {
        setSavedAt(result.updatedAt);
        setMessage('Saved. Kiosks pick this up on their next config read.');
      } else {
        setMessage(result.error);
      }
    });
  }

  return (
    <div className="grid-2">
      <div>
        <KioskMediaLibrary menu={menu} />
        <KioskAttractSettings draft={draft} flow={flow} patch={patch} />
        <KioskFlowEntryEditor
          flow={flow}
          menu={menu}
          editableNodes={editableNodes}
          patchEntry={patchEntry}
        />
        <KioskOrderingSettings flow={flow} patch={patch} />
        <KioskTimingSettings flow={flow} patch={patch} />
        <button className="button" type="button" onClick={save} disabled={pending}>
          {pending ? 'Saving…' : 'Save kiosk flow'}
        </button>
        {message ? <div className="notice">{message}</div> : null}
      </div>

      <div>
        <div className="card" style={{ position: 'sticky', top: 24 }}>
          <h2>
            What a device will draw{' '}
            {flow.entryDerived ? <span className="pill accent">derived from menu</span> : null}
          </h2>
          <KioskFlowPreview flow={flow} menu={menu} brandName={brandName} />
          <p className="subtitle">
            {flow.tenders.length} way{flow.tenders.length === 1 ? '' : 's'} to pay ·{' '}
            {flow.family === 'pack' ? 'container' : 'item'} ordering ·{' '}
            {flow.guestName.mode === 'off' ? 'no name asked' : `name ${flow.guestName.mode}`}
          </p>
          <p className="subtitle kiosk-sync-meta">
            {savedAt
              ? `Last published ${new Date(savedAt).toLocaleString()}`
              : 'Demo preview'} · changes here are local until you save
          </p>
          {notes.length > 0 ? (
            <>
              <h2>What a device would ignore</h2>
              {notes.map((note) => (
                <div className="notice" key={`${note.path}-${note.message}`}>
                  <code>{note.path}</code> — {note.message}
                </div>
              ))}
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
