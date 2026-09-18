'use client';

import { useState } from 'react';

import {
  addSpan, dayIsAllDay, dayIssue, removeSpan, setAllDay, setOpen, setSpan, weekFrom, weekJson,
  type WeekDraft,
} from '@/lib/hours-editing';
import {
  crossesMidnight, DAY_LABEL, DAY_NAME, isClock, MAX_SPANS_PER_DAY, WEEKDAYS, type HoursByDay,
  type HourSpan, type Weekday,
} from '@/lib/location-hours';

import { FromGoogle } from './field-label';

type HoursEditorProps = {
  readonly initial: Readonly<HoursByDay>;
  /** The week still holds a Google listing's hours: the wizard's review cue. */
  readonly fromGoogle?: boolean;
  /** The wizard's step check blames the hours. */
  readonly invalid?: boolean;
  /** Told of every edit. A server-rendered page cannot pass one, and has nothing to track. */
  readonly onEdited?: () => void;
};

type DayProps = {
  readonly week: WeekDraft;
  readonly day: Weekday;
  readonly onChange: (next: WeekDraft) => void;
};

function finished(span: HourSpan): boolean {
  return isClock(span.open) && isClock(span.close);
}

function Spans({ week, day, onChange }: DayProps) {
  const spans = week[day];
  const name = DAY_NAME[day];
  return (
    <div className="hours-spans">
      {spans.map((span, index) => (
        <div className="hours-span" key={index}>
          <input type="time" required aria-label={`${name} opens`} value={span.open}
            onChange={(event) => onChange(setSpan(week, day, index, 'open', event.target.value))} />
          <span aria-hidden="true">–</span>
          <input type="time" required aria-label={`${name} closes`} value={span.close}
            onChange={(event) => onChange(setSpan(week, day, index, 'close', event.target.value))} />
          {finished(span) && crossesMidnight(span) ? <small>next day</small> : null}
          {spans.length > 1 ? (
            <button type="button" className="hours-link" aria-label={`Remove ${name} hours ${index + 1}`}
              onClick={() => onChange(removeSpan(week, day, index))}>Remove</button>
          ) : null}
        </div>
      ))}
      {spans.length < MAX_SPANS_PER_DAY ? (
        <button type="button" className="hours-link" onClick={() => onChange(addSpan(week, day))}>
          Add hours<span className="sr-only"> on {name}</span>
        </button>
      ) : null}
    </div>
  );
}

function Day({ week, day, onChange }: DayProps) {
  const spans = week[day];
  const open = spans.length > 0;
  const allDay = dayIsAllDay(spans);
  // A half-typed row is the browser's to flag, since its inputs are
  // required; this names what a finished day gets wrong, in the server's words.
  const issue = spans.every(finished) ? dayIssue(spans) : null;
  const issueId = `hours-${day}-issue`;
  return (
    <div className="hours-day" role="group" aria-label={DAY_NAME[day]} aria-describedby={issue ? issueId : undefined}>
      <span className="hours-day-name" aria-hidden="true">{DAY_LABEL[day]}</span>
      <label className="hours-toggle">
        <input type="checkbox" checked={open} onChange={(event) => onChange(setOpen(week, day, event.target.checked))} />
        Open
      </label>
      {open ? (
        <label className="hours-toggle">
          <input type="checkbox" checked={allDay}
            onChange={(event) => onChange(setAllDay(week, day, event.target.checked))} />
          24 hours
        </label>
      ) : <span className="hours-closed">Closed</span>}
      {open && !allDay ? <Spans week={week} day={day} onChange={onChange} /> : null}
      {issue ? <p id={issueId} className="hours-day-issue">{issue}</p> : null}
    </div>
  );
}

/**
 * Per-day opening hours: a day may be closed, open around the clock, or open
 * for up to four spans, and a span may run past midnight. The week is posted
 * whole as JSON, so the server reads exactly what the operator sees. The one
 * editor serves the new-organization wizard and the new-location page alike.
 */
export function HoursEditor({ initial, fromGoogle = false, invalid = false, onEdited }: HoursEditorProps) {
  const [week, setWeek] = useState<WeekDraft>(() => weekFrom(initial));
  const change = (next: WeekDraft) => {
    setWeek(next);
    onEdited?.();
  };
  return (
    <fieldset className={`hours-editor${fromGoogle ? ' from-google' : ''}`} data-field="hours" tabIndex={-1}
      aria-invalid={invalid || undefined} aria-errormessage={invalid ? 'organization-step-error' : undefined}>
      <legend>Opening hours{fromGoogle ? <FromGoogle /> : null}</legend>
      <p className="hours-hint">A closing time earlier than the opening time runs past midnight.</p>
      <input type="hidden" name="hours" value={weekJson(week)} />
      {WEEKDAYS.map((day) => <Day key={day} week={week} day={day} onChange={change} />)}
    </fieldset>
  );
}
