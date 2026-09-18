import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  checkDay, crossesMidnight, hoursSummary, isAllDay, packSpan, parseHoursByDay,
} from './location-hours';

describe('a day of spans', () => {
  it('sorts spans into opening order', () => {
    assert.deepEqual(checkDay([{ open: '17:00', close: '21:00' }, { open: '07:00', close: '11:00' }]), {
      ok: true, spans: [{ open: '07:00', close: '11:00' }, { open: '17:00', close: '21:00' }],
    });
  });

  it('lets spans touch, but not overlap', () => {
    assert.equal(checkDay([{ open: '08:00', close: '12:00' }, { open: '12:00', close: '16:00' }]).ok, true);
    assert.deepEqual(checkDay([{ open: '08:00', close: '12:01' }, { open: '12:00', close: '16:00' }]),
      { ok: false, issue: 'overlap' });
  });

  it('counts an overnight span as open through the rest of its day', () => {
    // Lunch then a late session is fine; a late session with anything after it is not.
    assert.equal(checkDay([{ open: '11:00', close: '14:00' }, { open: '20:00', close: '03:00' }]).ok, true);
    assert.deepEqual(checkDay([{ open: '20:00', close: '03:00' }, { open: '21:00', close: '22:00' }]),
      { ok: false, issue: 'overlap' });
  });

  it('refuses malformed clocks, a zero-length span, and more than four spans', () => {
    assert.deepEqual(checkDay([{ open: '24:00', close: '01:00' }]), { ok: false, issue: 'format' });
    assert.deepEqual(checkDay([{ open: '7:00', close: '09:00' }]), { ok: false, issue: 'format' });
    assert.deepEqual(checkDay([{ open: '09:00', close: '09:00' }]), { ok: false, issue: 'same_minute' });
    const five = ['00', '02', '04', '06', '08'].map((hour) => ({ open: `${hour}:00`, close: `${hour}:30` }));
    assert.deepEqual(checkDay(five), { ok: false, issue: 'too_many' });
  });
});

describe('the shapes a span can say', () => {
  it('reads a close before its open as the next morning', () => {
    assert.equal(crossesMidnight({ open: '22:00', close: '02:00' }), true);
    assert.equal(crossesMidnight({ open: '18:00', close: '00:00' }), true);
    assert.equal(crossesMidnight({ open: '08:00', close: '17:00' }), false);
    assert.equal(crossesMidnight({ open: '00:00', close: '23:59' }), false);
  });

  it('reads 00:00–23:59 as around the clock', () => {
    assert.equal(isAllDay({ open: '00:00', close: '23:59' }), true);
    assert.equal(isAllDay({ open: '00:00', close: '23:00' }), false);
  });

  it('writes brand.json’s form past 24:00 only for spans that cross midnight', () => {
    assert.deepEqual(packSpan({ open: '22:00', close: '02:00' }), { open: '22:00', close: '26:00' });
    assert.deepEqual(packSpan({ open: '18:00', close: '00:00' }), { open: '18:00', close: '24:00' });
    assert.deepEqual(packSpan({ open: '21:30', close: '00:45' }), { open: '21:30', close: '24:45' });
    assert.deepEqual(packSpan({ open: '08:00', close: '17:00' }), { open: '08:00', close: '17:00' });
    assert.deepEqual(packSpan({ open: '00:00', close: '23:59' }), { open: '00:00', close: '23:59' });
  });
});

describe('per-day hours from the form', () => {
  it('accepts the object as well as its JSON, and leaves closed days out', () => {
    const week = { mon: [{ open: '08:00', close: '17:00' }], tue: [] };
    assert.deepEqual(parseHoursByDay(week), { ok: true, hours: { mon: [{ open: '08:00', close: '17:00' }] } });
    assert.deepEqual(parseHoursByDay(JSON.stringify(week)), parseHoursByDay(week));
  });

  it('trims each clock before checking it', () => {
    assert.deepEqual(parseHoursByDay({ wed: [{ open: ' 09:00 ', close: '15:00 ' }] }),
      { ok: true, hours: { wed: [{ open: '09:00', close: '15:00' }] } });
  });

  it('refuses anything that is not a week of spans', () => {
    for (const raw of [null, 7, [], 'null', '[]', '{"mon":[1]}', '{"mon":[{"open":1,"close":2}]}']) {
      assert.equal(parseHoursByDay(raw).ok, false, JSON.stringify(raw));
    }
  });
});

describe('the summary the console lists', () => {
  it('reads days that share hours once, in weekday order', () => {
    assert.equal(hoursSummary({
      sat: [{ open: '09:00', close: '14:00' }],
      mon: [{ open: '08:00', close: '17:00' }],
      wed: [{ open: '08:00', close: '17:00' }],
      tue: [{ open: '10:00', close: '12:00' }, { open: '13:00', close: '18:00' }],
    }), 'Mon Wed 08:00–17:00 · Tue 10:00–12:00, 13:00–18:00 · Sat 09:00–14:00');
  });

  it('says 24 hours for an around-the-clock day and keeps overnight spans as typed', () => {
    assert.equal(hoursSummary({
      fri: [{ open: '18:00', close: '02:00' }], sun: [{ open: '00:00', close: '23:59' }],
    }), 'Fri 18:00–02:00 · Sun 24 hours');
  });

  it('is empty for a week with no open day', () => {
    assert.equal(hoursSummary({}), '');
  });
});
