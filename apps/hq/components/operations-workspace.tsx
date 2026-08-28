import Link from 'next/link';

import type { OperationsWorkspace } from '@/lib/operations-data';
import {
  createManualOperation,
  createOperationSchedule,
  saveOperationRetention,
  resolveOperationIssue,
  toggleOperationSchedule,
  cancelOperation,
} from '@/app/(console)/operations/actions';

export type OperationsView = 'live' | 'templates' | 'schedules' | 'history' | 'reporting' | 'retention';
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

function EmptyState({ children }: { children: string }) {
  return <div className="notice" role="status">{children}</div>;
}

function StatusPill({ status }: { status: string }) {
  const tone = status === 'completed' ? 'success'
    : status === 'overdue' ? 'danger'
      : status === 'scheduled' || status === 'claimed' ? 'warning' : '';
  return <span className={`pill ${tone}`}>{status.replace('_', ' ')}</span>;
}

function LocalTime({ value }: { value: string }) {
  return <time dateTime={value}>{new Date(value).toLocaleString('en-US', {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  })}</time>;
}

function LiveBoard({ workspace }: { workspace: OperationsWorkspace }) {
  const active = workspace.occurrences.filter((item) =>
    ['scheduled', 'claimed', 'overdue'].includes(item.status)).slice(0, 100);
  return (
    <>
      <div className="operations-heading"><div><p className="eyebrow">Location execution</p><h1>Live operations</h1><p className="subtitle">Current work reconciled through tenant and location policies.</p></div><Link className="button secondary" href="/operations/history">Review history</Link></div>
      <form action={createManualOperation} className="card operations-create-form">
        <label>Location<select name="locationId" required>{workspace.locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}</select></label>
        <label>Approved template<select name="templateId" required>{workspace.templates.filter((template) => template.active).map((template) => <option key={template.id} value={template.id}>{template.title} · v{template.revision}</option>)}</select></label>
        <label>Due window<input defaultValue={30} min={1} max={1440} name="dueWindowMinutes" required type="number" /></label>
        <button className="button" disabled={workspace.locations.length === 0 || workspace.templates.length === 0} type="submit">Create due-now operation</button>
      </form>
      <div className="operations-kpis" aria-label="Current operations summary">
        {(['scheduled', 'claimed', 'overdue'] as const).map((status) => <div className="card" key={status}><span>{status}</span><strong>{active.filter((item) => item.status === status).length}</strong></div>)}
        <div className="card"><span>Open issues</span><strong>{workspace.issues.filter((item) => item.status !== 'resolved' && item.status !== 'dismissed').length}</strong></div>
      </div>
      {active.length === 0 ? <EmptyState>No work is scheduled in the current queue.</EmptyState> : (
        <div className="card operations-table"><table><thead><tr><th>Operation</th><th>Location</th><th>Scheduled</th><th>Status</th><th>Manager action</th></tr></thead><tbody>
          {active.map((item) => <tr key={item.id}><td><strong>{item.title}</strong></td><td>{item.locationName}</td><td><LocalTime value={item.scheduledFor} /></td><td><StatusPill status={item.status} /></td><td>{item.persistedStatus === 'scheduled' ? <form action={cancelOperation} className="operations-inline-form"><input type="hidden" name="occurrenceId" value={item.id} /><input required minLength={3} maxLength={500} name="reason" aria-label={`Cancellation reason for ${item.title}`} placeholder="Reason" /><button className="button secondary" type="submit">Cancel</button></form> : <span className="muted">Claimed by staff</span>}</td></tr>)}
        </tbody></table></div>
      )}
      <h2 className="operations-section-title">Open issues</h2>
      {workspace.issues.filter((item) => item.status === 'open' || item.status === 'acknowledged').length === 0
        ? <EmptyState>No operation issues need manager follow-up.</EmptyState>
        : <div className="card operations-table"><table><thead><tr><th>Category</th><th>Severity</th><th>Reported</th><th>Resolution</th></tr></thead><tbody>{workspace.issues.filter((item) => item.status === 'open' || item.status === 'acknowledged').map((item) => <tr key={item.id}><td><strong>{item.category}</strong></td><td><StatusPill status={item.severity} /></td><td><LocalTime value={item.createdAt} /></td><td><form action={resolveOperationIssue} className="operations-inline-form"><input type="hidden" name="issueId" value={item.id} /><input required minLength={3} maxLength={2000} name="resolution" aria-label={`Resolution for ${item.category}`} placeholder="Resolution" /><button className="button secondary" type="submit">Resolve</button></form></td></tr>)}</tbody></table></div>}
    </>
  );
}

function TemplateLibrary({ workspace }: { workspace: OperationsWorkspace }) {
  return <><div className="operations-heading"><div><p className="eyebrow">Versioned standards</p><h1>Templates</h1><p className="subtitle">Brand standards and location overrides; completed work keeps its original snapshot.</p></div></div><div className="notice" role="note">Config-managed standards are published through the tenant operations artifact so procedure, role, competency, escalation, and retention changes receive one controlled review. New revisions never rewrite completed evidence.</div>{workspace.templates.length === 0 ? <EmptyState>No operation templates have been published.</EmptyState> : <div className="card operations-table"><table><thead><tr><th>Template</th><th>Revision</th><th>Scope</th><th>Estimate</th><th>Source</th><th>Status</th></tr></thead><tbody>{workspace.templates.map((item) => <tr key={item.id}><td><strong>{item.title}</strong><br /><span className="muted">{item.key}</span></td><td>v{item.revision}</td><td>{item.locationId ? 'Location override' : 'Brand standard'}</td><td>{item.estimatedMinutes} min</td><td>{item.managedByConfig ? 'Tenant artifact' : 'HQ'}</td><td><StatusPill status={item.active ? 'active' : 'inactive'} /></td></tr>)}</tbody></table></div>}</>;
}

function ScheduleList({ workspace }: { workspace: OperationsWorkspace }) {
  const activeTemplates = workspace.templates.filter((template) => template.active);
  const canCreate = workspace.locations.length > 0 && activeTemplates.length > 0;
  return <>
    <div className="operations-heading"><div>
      <p className="eyebrow">Local-time scheduling</p><h1>Schedules</h1>
      <p className="subtitle">Each schedule uses its location’s IANA timezone and immutable occurrence snapshots.</p>
    </div></div>
    <form action={createOperationSchedule} className="card operations-create-form">
      <label>Schedule key<input name="scheduleKey" pattern="[a-z0-9][a-z0-9-]{0,79}"
        placeholder="weekday-opening" required /></label>
      <label>Location<select name="locationId" required>{workspace.locations.map((location) =>
        <option key={location.id} value={location.id}>{location.name}</option>)}</select></label>
      <label>Template<select name="templateId" required>{activeTemplates.map((template) =>
        <option key={template.id} value={template.id}>{template.title} · v{template.revision}</option>)}</select></label>
      <label>Timing rule<select defaultValue="fixed_time" name="scheduleKind">
        <option value="fixed_time">Fixed local time</option>
        <option value="opening_offset">Relative to opening</option>
        <option value="closing_offset">Relative to closing</option>
        <option value="open_interval">Repeat during open hours</option>
      </select></label>
      <label>Fixed start time<input name="localStartTime" type="time" /></label>
      <label>Start/anchor offset (minutes)<input defaultValue={0} min={-1440} max={1440}
        name="anchorOffsetMinutes" type="number" /></label>
      <label>Repeat every (minutes)<input defaultValue={60} min={15} max={1440}
        name="intervalMinutes" type="number" /></label>
      <label>Stop offset (minutes)<input defaultValue={480} min={-1440} max={1440}
        name="intervalEndOffsetMinutes" type="number" /></label>
      <label>Cadence<select name="recurrence"><option value="daily">Daily</option>
        <option value="weekly">Weekly</option></select></label>
      <fieldset><legend>Weekly days</legend>
        {WEEKDAYS.map((label, index) => <label className="operations-check" key={label}>
            <input name="weekday" type="checkbox" value={index + 1} />{label}
          </label>)}
      </fieldset>
      <label>Due window<input defaultValue={30} min={1} max={1440}
        name="dueWindowMinutes" required type="number" /></label>
      <label>Grace<input defaultValue={10} min={0} max={1440}
        name="graceMinutes" required type="number" /></label>
      <button className="button" disabled={!canCreate} type="submit">Create schedule</button>
    </form>
    {workspace.schedules.length === 0
      ? <EmptyState>No schedules are active. Publish approved times after the procedure and training are ready.</EmptyState>
      : <div className="card operations-table"><table><thead><tr><th>Schedule</th><th>Location</th>
        <th>Template</th><th>Cadence</th><th>Due window</th><th>Status</th></tr></thead><tbody>
        {workspace.schedules.map((item) => <tr key={item.id}>
          <td><strong>{item.key}</strong><br /><span className="muted">
            {item.localStartTime?.slice(0, 5) ?? item.scheduleKind.replaceAll('_', ' ')}</span></td>
          <td>{item.locationName}</td><td>{item.templateTitle}</td>
          <td>{item.recurrence === 'daily' ? 'Daily' : `Weekly · ${item.weekdays.join(', ')}`}</td>
          <td>{item.dueWindowMinutes} min + {item.graceMinutes} grace</td>
          <td><form action={toggleOperationSchedule}>
            <input type="hidden" name="scheduleId" value={item.id} />
            <input type="hidden" name="enabled" value={item.enabled ? 'false' : 'true'} />
            <button className="button secondary" type="submit">{item.enabled ? 'Pause' : 'Enable'}</button>
          </form></td>
        </tr>)}
      </tbody></table></div>}
  </>;
}

function History({ workspace }: { workspace: OperationsWorkspace }) {
  return <><div className="operations-heading"><div><p className="eyebrow">Immutable occurrence record</p><h1>History</h1><p className="subtitle">Thirty-one days of completions, misses, cancellations, and accountable late work.</p></div></div>{workspace.occurrences.length === 0 ? <EmptyState>No occurrence history is available.</EmptyState> : <div className="card operations-table"><table><thead><tr><th>Operation</th><th>Location</th><th>Scheduled</th><th>Completed</th><th>Status</th></tr></thead><tbody>{workspace.occurrences.map((item) => <tr key={item.id}><td><strong>{item.title}</strong>{item.completionNote ? <><br /><span className="muted">{item.completionNote}</span></> : null}</td><td>{item.locationName}</td><td><LocalTime value={item.scheduledFor} /></td><td>{item.completedAt ? <LocalTime value={item.completedAt} /> : '—'}</td><td><StatusPill status={item.status} /></td></tr>)}</tbody></table></div>}</>;
}

function Reporting({ workspace }: { workspace: OperationsWorkspace }) {
  const metric = (value: number | null) => value === null ? '—' : `${Math.round(value * 100)}%`;
  return <><div className="operations-heading"><div><p className="eyebrow">Franchise accountability</p><h1>Reporting</h1><p className="subtitle">Rates exclude future and cancelled work from the accountable denominator.</p></div><Link className="button secondary" href="/operations/reporting/export">Export CSV</Link></div><div className="operations-kpis"><div className="card"><span>Accountable</span><strong>{workspace.metrics.accountable}</strong></div><div className="card"><span>Completion rate</span><strong>{metric(workspace.metrics.completionRate)}</strong></div><div className="card"><span>On-time rate</span><strong>{metric(workspace.metrics.onTimeRate)}</strong></div><div className="card"><span>Overdue rate</span><strong>{metric(workspace.metrics.overdueRate)}</strong></div></div><div className="card"><h2>Issue signal</h2><p className="subtitle">{workspace.issues.length} issues reported in the loaded history window; {workspace.issues.filter((item) => item.status === 'open').length} remain open.</p></div></>;
}

function Retention({ workspace }: { workspace: OperationsWorkspace }) {
  return <><div className="operations-heading"><div><p className="eyebrow">Evidence lifecycle</p><h1>Retention</h1><p className="subtitle">Evidence is removed and staff identity anonymized on independent schedules.</p></div></div>{!workspace.canEditBrandDefaults ? <EmptyState>Only a brand owner can change retention policy.</EmptyState> : <form action={saveOperationRetention} className="card operations-retention"><label>Checklist evidence<input name="evidenceDays" type="number" min="30" max="3650" required defaultValue={workspace.retention.evidenceDays} /></label><label>Issue detail<input name="issueDays" type="number" min="30" max="3650" required defaultValue={workspace.retention.issueDays} /></label><label>Actor identity<input name="actorIdentityDays" type="number" min="30" max="3650" required defaultValue={workspace.retention.actorIdentityDays} /></label><button className="button" type="submit">Save retention</button></form>}</>;
}

export function OperationsRoute({ view, workspace }: { view: OperationsView; workspace: OperationsWorkspace }) {
  if (!workspace.enabled) return <><h1>Operations</h1><EmptyState>Operations are not enabled for this tenant or role.</EmptyState></>;
  if (view === 'templates') return <TemplateLibrary workspace={workspace} />;
  if (view === 'schedules') return <ScheduleList workspace={workspace} />;
  if (view === 'history') return <History workspace={workspace} />;
  if (view === 'reporting') return <Reporting workspace={workspace} />;
  if (view === 'retention') return <Retention workspace={workspace} />;
  return <LiveBoard workspace={workspace} />;
}
