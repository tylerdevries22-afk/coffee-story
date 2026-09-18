import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  addSpan, dayIsAllDay, dayIssue, removeSpan, setAllDay, setOpen, setSpan, weekFrom, weekJson,
} from './hours-editing';
import { parseHoursByDay } from './location-hours';

const week = weekFrom({ mon: [{ open: '08:00', close: '17:00' }], fri: [{ open: '18:00', close: '01:00' }] });

describe('the hours editor', () => {
  it('starts from any week, with every day present and closed days empty', () => {
    assert.deepEqual(week.mon, [{ open: '08:00', close: '17:00' }]);
    assert.deepEqual(week.tue, []);
    assert.deepEqual(week.fri, [{ open: '18:00', close: '01:00' }]);
  });

  it('edits one time in one span and leaves the rest of the week alone', () => {
    const edited = setSpan(week, 'mon', 0, 'close', '16:30');
    assert.deepEqual(edited.mon, [{ open: '08:00', close: '16:30' }]);
    assert.equal(edited.fri, week.fri);
    assert.deepEqual(week.mon, [{ open: '08:00', close: '17:00' }], 'the earlier week is not mutated');
  });

  it('opens a closed day on standard hours and closes an open one', () => {
    assert.deepEqual(setOpen(week, 'tue', true).tue, [{ open: '08:00', close: '17:00' }]);
    assert.deepEqual(setOpen(week, 'mon', false).mon, []);
  });

  it('switches a day to around the clock and back', () => {
    const allDay = setAllDay(week, 'sat', true);
    assert.equal(dayIsAllDay(allDay.sat), true);
    assert.equal(dayIsAllDay(setAllDay(allDay, 'sat', false).sat), false);
    assert.equal(dayIsAllDay(week.mon), false);
  });

  it('adds a blank span to fill in, up to four, and removes one', () => {
    let split = addSpan(week, 'mon');
    assert.deepEqual(split.mon[1], { open: '', close: '' });
    assert.equal(dayIssue(split.mon), 'Enter each opening and closing time as HH:MM.');
    split = setSpan(setSpan(split, 'mon', 1, 'open', '18:00'), 'mon', 1, 'close', '21:00');
    assert.equal(dayIssue(split.mon), null);
    const full = addSpan(addSpan(addSpan(split, 'mon'), 'mon'), 'mon');
    assert.equal(full.mon.length, 4);
    assert.deepEqual(removeSpan(split, 'mon', 0).mon, [{ open: '18:00', close: '21:00' }]);
  });

  it('names an overlap in the words the server would use', () => {
    const overlapping = setSpan(addSpan(week, 'mon'), 'mon', 1, 'open', '16:00');
    assert.equal(dayIssue(setSpan(overlapping, 'mon', 1, 'close', '18:00').mon), 'Two sets of hours on the same day overlap.');
  });

  it('posts every day, and the server reads it back as the same week', () => {
    const posted = weekJson(week);
    assert.deepEqual(Object.keys(JSON.parse(posted) as object), ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']);
    assert.deepEqual(parseHoursByDay(posted), {
      ok: true, hours: { mon: [{ open: '08:00', close: '17:00' }], fri: [{ open: '18:00', close: '01:00' }] },
    });
  });
});
