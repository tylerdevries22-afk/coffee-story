import type { DemoBatchSummary } from '@/lib/demo-factory/console-data';
import { DEMO_BATCH_MAX } from '@/lib/demo-factory/console-input';
import { estimateDemoMicrousd, formatMicrousd } from '@/lib/demo-factory/prices';

import { startDemoBatch, stopBatch } from './actions';

/**
 * A new batch, with its price stated before it is asked for. The search is
 * free; each business it queues is expected to cost the per-business estimate,
 * and the ledger shows what it actually cost once it is built.
 */
export function DemoBatchForm({ disabled }: { disabled: boolean }) {
  const each = estimateDemoMicrousd();
  return (
    <section className="factory-panel">
      <div className="factory-panel-heading">
        <div><p className="factory-eyebrow">New batch</p><h2>Find businesses to demo</h2></div>
        <span className="badge">about {formatMicrousd(each)} each</span>
      </div>
      <form action={startDemoBatch} className="factory-form">
        <div className="factory-field-row">
          <label className="field">Search
            <input name="query" required minLength={3} maxLength={200} placeholder="coffee shops in Boulder, CO" />
          </label>
          <label className="field">How many (1 to {DEMO_BATCH_MAX})
            <input name="count" inputMode="numeric" pattern="[0-9]{1,2}" required defaultValue="10" />
          </label>
        </div>
        <div className="factory-form-footer">
          <p>
            US businesses only. At most {formatMicrousd(each * DEMO_BATCH_MAX)} for a full batch of {DEMO_BATCH_MAX},
            in API calls: one listing lookup, a few photos and one website reading each. Businesses that asked to be
            left alone, or already have a demo, are skipped before anything is billed.
          </p>
          <button className="button" type="submit" disabled={disabled}>Queue the batch</button>
        </div>
      </form>
    </section>
  );
}

function outcome(batch: DemoBatchSummary): string {
  const parts = [
    batch.built ? `${batch.built} built` : '',
    batch.queued + batch.working ? `${batch.queued + batch.working} to go` : '',
    batch.skipped ? `${batch.skipped} skipped` : '',
    batch.failed ? `${batch.failed} failed` : '',
  ].filter(Boolean);
  return parts.join(' · ') || 'nothing found';
}

const STATE_CLASS: Readonly<Record<DemoBatchSummary['state'], string>> = {
  running: ' factory-state-running',
  done: ' factory-state-live',
  stopped: '',
};

/** Businesses the estimate covers: every one that was, is or will be tried. */
function attempted(batch: DemoBatchSummary): number {
  return batch.built + batch.queued + batch.working + batch.failed;
}

/** Recent batches: what became of each business, and estimate beside actual. */
export function DemoBatchList({ batches }: { batches: readonly DemoBatchSummary[] }) {
  return (
    <section className="card">
      <h2>Batches</h2>
      {batches.length === 0 ? (
        <p className="factory-muted">No batches yet. Queue one above; nothing is built until the factory is on.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Search</th><th>State</th><th>Businesses</th>
              <th className="num">Estimate</th><th className="num">Spent</th><th className="num">Per demo</th><th />
            </tr>
          </thead>
          <tbody>
            {batches.map((batch) => (
              <tr key={batch.id}>
                <td>{batch.query}<br /><small className="factory-muted">{batch.createdAt.slice(0, 16).replace('T', ' ')} UTC</small></td>
                <td><span className={`factory-state${STATE_CLASS[batch.state]}`}>{batch.state}</span></td>
                <td>{outcome(batch)}</td>
                <td className="num">{formatMicrousd(batch.unitEstimateMicrousd * attempted(batch))}</td>
                <td className="num">{formatMicrousd(batch.costMicrousd)}</td>
                <td className="num">{batch.built ? formatMicrousd(Math.round(batch.costMicrousd / batch.built)) : '—'}</td>
                <td>
                  {batch.state === 'running' ? (
                    <form action={stopBatch}>
                      <input type="hidden" name="batchId" value={batch.id} />
                      <button className="button secondary" type="submit">Stop</button>
                    </form>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
