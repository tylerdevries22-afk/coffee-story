'use client';

import { useMemo, useState, useTransition } from 'react';

import {
  inspectKioskFlow, resolveKioskFlow,
  type KioskEntryNode, type KioskMenuFacts, type KioskStepFamily, type KioskTender,
} from '@platform/domain';

import { saveKioskFlow } from '@/app/(console)/kiosk/actions';
import { KioskFlowPreview } from '@/components/kiosk-flow-preview';

const TENDERS: { id: KioskTender; label: string }[] = [
  { id: 'card', label: 'Card' },
  { id: 'cash', label: 'Pay at the counter' },
  { id: 'stored_value', label: 'Rewards balance' },
  { id: 'gift_card', label: 'Gift card' },
];

type Draft = Record<string, unknown>;

/**
 * The kiosk flow editor.
 *
 * The preview is not a mock: it calls the SAME `resolveKioskFlow` a device
 * calls, with the same menu facts, so what it renders is what a kiosk will
 * draw. The existing brand editor re-implements its own hex check for its
 * preview, and that is the precedent's weakness rather than its strength -- a
 * preview that reimplements the rule is a preview that can disagree with the
 * device about whether a config is valid.
 *
 * `inspectKioskFlow` is the other half: it reports what the resolver DROPPED
 * and why, by JSON path, so a dead tile is visible before it is saved rather
 * than discovered on a lobby screen.
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
  const [draft, setDraft] = useState<Draft>(() => (isRecord(initial) ? { ...initial } : {}));
  const [savedAt, setSavedAt] = useState(updatedAt);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const flow = useMemo(() => resolveKioskFlow(draft, { menu }), [draft, menu]);
  const notes = useMemo(() => inspectKioskFlow(draft, { menu }), [draft, menu]);

  const nodes = flow.entry.nodes;

  function patch(next: Draft) {
    setDraft((current) => ({ ...current, ...next }));
    setMessage(null);
  }

  function patchEntry(next: Record<string, unknown>) {
    const entry = isRecord(draft.entry) ? draft.entry : {};
    patch({ entry: { ...entry, ...next } });
  }

  /** Takes over the derived list, so an edit starts from what is on screen. */
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
        <div className="card">
          <h2>Attract screen</h2>
          <label className="field">
            Invitation
            <input
              value={flow.attract.invite}
              onChange={(event) => patch({
                attract: { ...(isRecord(draft.attract) ? draft.attract : {}), invite: event.target.value },
              })}
            />
          </label>
          <label className="field">
            Headline (optional — the brand name is used when empty)
            <input
              value={flow.attract.headline ?? ''}
              onChange={(event) => patch({
                attract: {
                  ...(isRecord(draft.attract) ? draft.attract : {}),
                  headline: event.target.value || null,
                },
              })}
            />
          </label>
        </div>

        <div className="card">
          <h2>First step</h2>
          <label className="field">
            Question
            <input value={flow.entry.prompt} onChange={(event) => patchEntry({ prompt: event.target.value })} />
          </label>

          {flow.entryDerived ? (
            <div className="notice">
              No tiles configured, so a device derives them from your menu. Editing one takes
              over the whole list — after that it stops following the menu, which is why the
              derived version is kept until you do.
            </div>
          ) : null}

          <table>
            <thead>
              <tr>
                <th>Label</th>
                <th>Goes to</th>
                <th>Size</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {nodes.map((node, index) => (
                <tr key={node.id}>
                  <td>
                    <input
                      value={node.label}
                      onChange={(event) => {
                        const next = editableNodes();
                        const target = next[index];
                        if (target) next[index] = { ...target, label: event.target.value };
                        patchEntry({ nodes: next });
                      }}
                    />
                  </td>
                  <td>
                    <select
                      value={node.target.kind === 'category' ? node.target.categoryId : ''}
                      onChange={(event) => {
                        const next = editableNodes();
                        const target = next[index];
                        if (target) {
                          next[index] = { ...target, target: { kind: 'category', categoryId: event.target.value } };
                        }
                        patchEntry({ nodes: next });
                      }}
                    >
                      {/* Only this brand's own categories: a tile cannot be
                          pointed at something that is not on the menu. */}
                      {menu.categories.map((category) => (
                        <option key={category.id} value={category.id}>{category.title}</option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <select
                      value={node.emphasis}
                      onChange={(event) => {
                        const next = editableNodes();
                        const target = next[index];
                        if (target) {
                          next[index] = { ...target, emphasis: event.target.value as KioskEntryNode['emphasis'] };
                        }
                        patchEntry({ nodes: next });
                      }}
                    >
                      <option value="hero">Hero</option>
                      <option value="standard">Standard</option>
                      <option value="minor">Minor</option>
                    </select>
                  </td>
                  <td className="num">
                    <button
                      className="button secondary"
                      type="button"
                      onClick={() => patchEntry({ nodes: editableNodes().filter((_, i) => i !== index) })}
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <button
            className="button secondary"
            type="button"
            onClick={() => {
              const first = menu.categories[0];
              if (!first) return;
              patchEntry({
                nodes: [...editableNodes(), {
                  id: `tile-${editableNodes().length + 1}`,
                  label: first.title,
                  emphasis: 'standard',
                  target: { kind: 'category', categoryId: first.id },
                }],
              });
            }}
          >
            Add a tile
          </button>
        </div>

        <div className="card">
          <h2>Ordering</h2>
          <label className="field">
            What this shop sells
            <select
              value={flow.family}
              onChange={(event) => patch({ family: event.target.value as KioskStepFamily })}
            >
              <option value="item">Items — a drink or a dish, with sizes and options</option>
              <option value="pack">Containers — a box the guest fills</option>
            </select>
          </label>

          <label className="field">
            Ask for a name
            <select
              value={flow.guestName.mode}
              onChange={(event) => patch({ guestName: { mode: event.target.value } })}
            >
              <option value="off">No — call the number</option>
              <option value="optional">Optional</option>
              <option value="required">Always</option>
            </select>
          </label>

          <fieldset className="field">
            <legend>How a guest can pay</legend>
            {TENDERS.map((tender) => (
              <label key={tender.id} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <input
                  type="checkbox"
                  style={{ width: 'auto' }}
                  checked={flow.tenders.includes(tender.id)}
                  onChange={(event) => {
                    const current = new Set(flow.tenders);
                    if (event.target.checked) current.add(tender.id);
                    else current.delete(tender.id);
                    patch({ tenders: [...current] });
                  }}
                />
                {tender.label}
              </label>
            ))}
          </fieldset>
        </div>

        <div className="card">
          <h2>Timing</h2>
          <label className="field">
            Warn an idle guest after (seconds)
            <input
              type="number"
              value={Math.round(flow.idle.warnMs / 1000)}
              onChange={(event) => patch({
                idle: { ...flow.idle, warnMs: Number(event.target.value) * 1000 },
              })}
            />
          </label>
          <label className="field">
            Clear the session after (seconds)
            <input
              type="number"
              value={Math.round(flow.idle.resetMs / 1000)}
              onChange={(event) => patch({
                idle: { ...flow.idle, resetMs: Number(event.target.value) * 1000 },
              })}
            />
          </label>
          <p className="subtitle">
            A shop whose guests fill a box should give longer: a reset mid-box is the worst thing
            a container kiosk can do.
          </p>
        </div>

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
            {savedAt ? `Last published ${new Date(savedAt).toLocaleString()}` : 'Demo preview'} · changes here are local until you save
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
