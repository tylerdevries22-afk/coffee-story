import type { KioskStepFamily, KioskTender } from '@platform/domain';

import {
  isRecord,
  type KioskDraft,
  type KioskFlow,
  type PatchKioskDraft,
} from './kiosk-flow-editor-types';

const TENDERS: { id: KioskTender; label: string }[] = [
  { id: 'card', label: 'Card' },
  { id: 'cash', label: 'Pay at the counter' },
  { id: 'stored_value', label: 'Rewards balance' },
  { id: 'gift_card', label: 'Gift card' },
];

export function KioskAttractSettings({
  draft,
  flow,
  patch,
}: {
  draft: KioskDraft;
  flow: KioskFlow;
  patch: PatchKioskDraft;
}) {
  return (
    <div className="card">
      <h2>Attract screen</h2>
      <label className="field">
        Invitation
        <input
          value={flow.attract.invite}
          onChange={(event) => patch({
            attract: {
              ...(isRecord(draft.attract) ? draft.attract : {}),
              invite: event.target.value,
            },
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
  );
}

export function KioskOrderingSettings({
  flow,
  patch,
}: {
  flow: KioskFlow;
  patch: PatchKioskDraft;
}) {
  return (
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
  );
}

export function KioskTimingSettings({
  flow,
  patch,
}: {
  flow: KioskFlow;
  patch: PatchKioskDraft;
}) {
  return (
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
  );
}
