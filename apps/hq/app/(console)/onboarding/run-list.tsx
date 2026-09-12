import { Icon } from '@/components/icon';
import { ProvisioningLoader } from '@/components/provisioning-loader';
import type { FactoryRunView } from '@/lib/factory-data';

import { resumeOnboardingRun } from './actions';

/** State keys are snake_case on the row and sentence-shaped on the screen. */
function runStateLabel(state: string): string {
  return state.replaceAll('_', ' ');
}

function FactoryRun({ run, admin }: { run: FactoryRunView; admin: boolean }) {
  const progress = run.totalTasks ? Math.round((run.completedTasks / run.totalTasks) * 100) : 0;
  return (
    <article className="factory-run">
      <div className="factory-run-primary">
        <div><strong>{run.businessName}</strong><span>{run.tenantSlug}</span></div>
        <span className={`factory-state factory-state-${run.state}`}>{runStateLabel(run.state)}</span>
      </div>
      {run.state !== 'live' ? (
        <ProvisioningLoader
          run={{
            state: run.state,
            stage: run.stage,
            businessName: run.businessName,
            completedTaskKeys: run.completedTaskKeys,
            blockedErrorCode: run.lastErrorCode,
          }}
        />
      ) : null}
      <div className="factory-progress" aria-label={`${progress}% complete`}><span style={{ width: `${progress}%` }} /></div>
      <div className="factory-run-meta">
        <span>{run.completedTasks} of {run.totalTasks} tasks</span>
        <span>{run.verifiedCredentials} of {run.requiredCredentials} credentials verified</span>
        <span>Stage: {runStateLabel(run.stage)}</span>
      </div>
      {admin && run.lastErrorCode === 'go_live_required' ? (
        <p className="muted">Awaiting owner/admin Go live on the organization page. Resume will not mint production hosts.</p>
      ) : null}
      {admin && (run.state === 'blocked' || run.state === 'failed') && run.lastErrorCode !== 'go_live_required' ? (
        <form action={resumeOnboardingRun}>
          <input type="hidden" name="runId" value={run.id} />
          <button className="button secondary" type="submit">Resume from checkpoint</button>
        </form>
      ) : null}
    </article>
  );
}

export function FactoryRunList({
  runs,
  admin,
  source,
}: {
  runs: readonly FactoryRunView[];
  admin: boolean;
  source: string;
}) {
  return (
    <section className="factory-panel">
      <div className="factory-panel-heading"><div><p className="factory-eyebrow">Automation runs</p><h2>Demo-to-live pipeline</h2></div><span className="badge">{runs.length} tenants</span></div>
      <div className="factory-run-list">
        {runs.length
          ? runs.map((run) => <FactoryRun key={run.id} run={run} admin={admin} />)
          : <div className="factory-empty"><Icon name="onboarding" size={22} /><strong>No tenant runs yet</strong><p>Create a private demo to begin the verified pipeline.</p></div>}
      </div>
      <p className="factory-source">Source: {source}. A failed task leaves the previous hosted release active and records a safe, auditable failure.</p>
    </section>
  );
}
