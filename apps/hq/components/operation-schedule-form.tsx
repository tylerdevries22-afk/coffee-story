'use client';

import { useMemo, useState } from 'react';

import { createOperationSchedule } from '@/app/(console)/operations/actions';
import type { OperationsWorkspace } from '@/lib/operations-data';
import { operationScheduleKindForRoutine } from '@/lib/operations-schedule';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;
type ScheduleFormProps = Pick<OperationsWorkspace, 'locations' | 'templates'>;

function TimingFields({ routineKind }: {
  routineKind: OperationsWorkspace['templates'][number]['routineKind'];
}) {
  const kind = operationScheduleKindForRoutine(routineKind);
  return <>
    <input name="scheduleKind" type="hidden" value={kind} />
    {kind === 'fixed_time' && <label>Fixed start time<input name="localStartTime" required type="time" /></label>}
    {(kind === 'opening_offset' || kind === 'closing_offset') &&
      <label>Offset from {routineKind} (minutes)<input defaultValue={0} min={-1440} max={1440}
        name="anchorOffsetMinutes" required type="number" /></label>}
    {kind === 'open_interval' && <>
      <label>Start after opening (minutes)<input defaultValue={0} min={-1440} max={1440}
        name="anchorOffsetMinutes" required type="number" /></label>
      <label>Repeat every (minutes)<input defaultValue={60} min={15} max={1440}
        name="intervalMinutes" required type="number" /></label>
      <label>Stop after opening (minutes)<input defaultValue={480} min={-1440} max={1440}
        name="intervalEndOffsetMinutes" required type="number" /></label>
    </>}
  </>;
}

/** A routine determines its timing shape, preventing invalid schedule/template combinations. */
export function OperationScheduleForm({ locations, templates }: ScheduleFormProps) {
  const activeTemplates = useMemo(() => templates.filter((template) => template.active), [templates]);
  const [templateId, setTemplateId] = useState(activeTemplates[0]?.id ?? '');
  const selected = activeTemplates.find((template) => template.id === templateId)
    ?? activeTemplates[0];
  const canCreate = locations.length > 0 && selected !== undefined;
  return <form action={createOperationSchedule} className="card operations-create-form">
    <label>Schedule key<input name="scheduleKey" pattern="[a-z0-9][a-z0-9-]{0,79}"
      placeholder="weekday-opening" required /></label>
    <label>Location<select name="locationId" required>{locations.map((location) =>
      <option key={location.id} value={location.id}>{location.name}</option>)}</select></label>
    <label>Template<select name="templateId" onChange={(event) => setTemplateId(event.target.value)}
      required value={selected?.id ?? ''}>{activeTemplates.map((template) =>
        <option key={template.id} value={template.id}>{template.title} · {template.routineKind}</option>)}</select></label>
    {selected && <TimingFields routineKind={selected.routineKind} />}
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
  </form>;
}
