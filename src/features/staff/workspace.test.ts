import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { PortalAppointment, StaffClient } from '@/types/domain';

import {
  agendaTotalCents,
  appointmentMinutes,
  appointmentsOn,
  deltaPercent,
  filterClients,
  formatMoney,
  initials,
  monthGrid,
  openGapMinutes,
  scheduleStrip,
  sourceLabel,
  startOfWeek,
  statusLabel,
} from './workspace';

function visit(overrides: Partial<PortalAppointment> & { startsAt: string; endsAt: string }): PortalAppointment {
  return {
    id: overrides.id ?? 'visit',
    serviceName: 'Swedish Massage',
    status: 'confirmed',
    subtotalCents: 10500,
    depositCents: 0,
    balanceCents: 10500,
    ...overrides,
  };
}

describe('appointmentMinutes', () => {
  it('measures the booked span in whole minutes', () => {
    const appointment = visit({
      startsAt: '2026-07-22T15:00:00.000Z',
      endsAt: '2026-07-22T16:15:00.000Z',
    });
    assert.equal(appointmentMinutes(appointment), 75);
  });

  it('never reports a negative duration for inverted times', () => {
    const appointment = visit({
      startsAt: '2026-07-22T16:00:00.000Z',
      endsAt: '2026-07-22T15:00:00.000Z',
    });
    assert.equal(appointmentMinutes(appointment), 0);
  });
});

describe('openGapMinutes', () => {
  it('reports the daylight between one visit and the next', () => {
    const first = visit({ startsAt: '2026-07-22T15:00:00.000Z', endsAt: '2026-07-22T17:00:00.000Z' });
    const second = visit({ startsAt: '2026-07-22T17:30:00.000Z', endsAt: '2026-07-22T18:30:00.000Z' });
    assert.equal(openGapMinutes(first, second), 30);
  });

  it('is zero for back-to-back and overlapping visits', () => {
    const first = visit({ startsAt: '2026-07-22T15:00:00.000Z', endsAt: '2026-07-22T17:00:00.000Z' });
    const touching = visit({ startsAt: '2026-07-22T17:00:00.000Z', endsAt: '2026-07-22T18:00:00.000Z' });
    const overlapping = visit({ startsAt: '2026-07-22T16:30:00.000Z', endsAt: '2026-07-22T18:00:00.000Z' });
    assert.equal(openGapMinutes(first, touching), 0);
    assert.equal(openGapMinutes(first, overlapping), 0);
  });

  it('is zero for the last visit of the day', () => {
    const only = visit({ startsAt: '2026-07-22T15:00:00.000Z', endsAt: '2026-07-22T16:00:00.000Z' });
    assert.equal(openGapMinutes(only, undefined), 0);
  });
});

describe('scheduleStrip', () => {
  it('prefers the recovery buffer over the raw gap, matching the web agenda', () => {
    const first = visit({
      startsAt: '2026-07-22T15:00:00.000Z',
      endsAt: '2026-07-22T16:00:00.000Z',
      recoveryMinutes: 15,
    });
    const second = visit({ startsAt: '2026-07-22T16:30:00.000Z', endsAt: '2026-07-22T17:30:00.000Z' });
    assert.deepEqual(scheduleStrip(first, second), { kind: 'recovery', minutes: 15 });
  });

  it('falls back to the open gap when no buffer is set', () => {
    const first = visit({ startsAt: '2026-07-22T15:00:00.000Z', endsAt: '2026-07-22T16:00:00.000Z' });
    const second = visit({ startsAt: '2026-07-22T16:30:00.000Z', endsAt: '2026-07-22T17:30:00.000Z' });
    assert.deepEqual(scheduleStrip(first, second), { kind: 'open', minutes: 30 });
  });

  it('renders nothing when the visits are back to back', () => {
    const first = visit({ startsAt: '2026-07-22T15:00:00.000Z', endsAt: '2026-07-22T16:00:00.000Z' });
    const second = visit({ startsAt: '2026-07-22T16:00:00.000Z', endsAt: '2026-07-22T17:00:00.000Z' });
    assert.equal(scheduleStrip(first, second), null);
  });
});

describe('formatMoney', () => {
  it('drops cents for whole dollars and keeps them otherwise', () => {
    assert.equal(formatMoney(18500), '$185');
    assert.equal(formatMoney(18550), '$185.50');
    assert.equal(formatMoney(0), '$0');
  });

  it('groups thousands', () => {
    assert.equal(formatMoney(232000), '$2,320');
  });
});

describe('initials', () => {
  it('takes the first letter of the first two words', () => {
    assert.equal(initials('Maria Alvarez'), 'MA');
    assert.equal(initials('Cher'), 'C');
    assert.equal(initials('  jordan  avery  quinn '), 'JA');
  });
});

describe('deltaPercent', () => {
  it('reports the change against the prior period', () => {
    assert.equal(deltaPercent(112, 100), 12);
    assert.equal(deltaPercent(90, 100), -10);
  });

  it('has no answer without a usable baseline', () => {
    assert.equal(deltaPercent(120, 0), null);
    assert.equal(deltaPercent(120, undefined), null);
  });
});

describe('sourceLabel', () => {
  it('titles the online sources and names staff bookings plainly', () => {
    assert.equal(sourceLabel('website'), 'Website');
    assert.equal(sourceLabel('directory'), 'Directory');
    assert.equal(sourceLabel('staff'), 'Added by you');
    assert.equal(sourceLabel(undefined), null);
  });
});

describe('statusLabel', () => {
  it('reads no_show as two words', () => {
    assert.equal(statusLabel('no_show'), 'no show');
    assert.equal(statusLabel('confirmed'), 'confirmed');
  });
});

describe('appointmentsOn', () => {
  it('keeps only the chosen day and orders it by start time', () => {
    const day = new Date('2026-07-22T12:00:00.000Z');
    const later = visit({ id: 'later', startsAt: '2026-07-22T20:00:00.000Z', endsAt: '2026-07-22T21:00:00.000Z' });
    const earlier = visit({ id: 'earlier', startsAt: '2026-07-22T14:00:00.000Z', endsAt: '2026-07-22T15:00:00.000Z' });
    const otherDay = visit({ id: 'other', startsAt: '2026-07-23T14:00:00.000Z', endsAt: '2026-07-23T15:00:00.000Z' });
    const result = appointmentsOn([later, earlier, otherDay], day);
    assert.deepEqual(result.map((appointment) => appointment.id), ['earlier', 'later']);
  });
});

describe('agendaTotalCents', () => {
  it('sums the booked value of the day', () => {
    const first = visit({ startsAt: '2026-07-22T15:00:00.000Z', endsAt: '2026-07-22T16:00:00.000Z', subtotalCents: 18500 });
    const second = visit({ startsAt: '2026-07-22T17:00:00.000Z', endsAt: '2026-07-22T18:00:00.000Z', subtotalCents: 11000 });
    assert.equal(agendaTotalCents([first, second]), 29500);
  });
});

describe('filterClients', () => {
  const clients: StaffClient[] = [
    { id: '1', fullName: 'Maria Alvarez', email: 'maria@email.com', phone: null, completedVisits: 14, tags: ['Regular', 'Trigger point'] },
    { id: '2', fullName: 'Tom Becker', email: 'tbecker@email.com', phone: null, completedVisits: 9, tags: ['Sports', 'Membership'] },
    { id: '3', fullName: 'Dana Kim', email: 'dana.kim@email.com', phone: null, completedVisits: 2, tags: [] },
  ];

  it('matches on name or email, case-insensitively', () => {
    assert.deepEqual(filterClients(clients, 'MARIA', null).map((c) => c.id), ['1']);
    assert.deepEqual(filterClients(clients, 'tbecker', null).map((c) => c.id), ['2']);
  });

  it('narrows by tag and combines both filters', () => {
    assert.deepEqual(filterClients(clients, '', 'Membership').map((c) => c.id), ['2']);
    assert.deepEqual(filterClients(clients, 'maria', 'Membership').map((c) => c.id), []);
  });

  it('returns everyone when nothing is applied', () => {
    assert.equal(filterClients(clients, '   ', null).length, 3);
  });

  it('treats a client with no tags as unmatched rather than crashing', () => {
    assert.deepEqual(filterClients(clients, '', 'Regular').map((c) => c.id), ['1']);
  });
});

describe('monthGrid', () => {
  it('describes the leading blanks and length of the month', () => {
    // July 2026 starts on a Wednesday and runs 31 days.
    assert.deepEqual(monthGrid(new Date(2026, 6, 15)), { leading: 3, days: 31 });
    // February 2026 starts on a Sunday and runs 28 days.
    assert.deepEqual(monthGrid(new Date(2026, 1, 10)), { leading: 0, days: 28 });
  });
});

describe('startOfWeek', () => {
  it('walks back to Sunday and clears the clock', () => {
    const start = startOfWeek(new Date(2026, 6, 22, 15, 30));
    assert.equal(start.getDay(), 0);
    assert.equal(start.getDate(), 19);
    assert.equal(start.getHours(), 0);
  });
});
