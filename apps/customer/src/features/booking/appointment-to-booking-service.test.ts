import assert from 'node:assert/strict';
import { test } from 'node:test';

import { appointmentToBookingService } from './appointment-to-booking-service';

const appointment = {
  id: 'visit-1', serviceName: 'Swedish Massage', startsAt: '2026-08-01T16:00:00Z', endsAt: '2026-08-01T17:15:00Z',
  status: 'confirmed', subtotalCents: 10500, depositCents: 2500, balanceCents: 8000,
} as const;

test('projects an appointment span and price into a calendar service', () => {
  assert.deepEqual(appointmentToBookingService(appointment), {
    slug: 'visit-1', name: 'Swedish Massage', category: 'signature', durationMin: 75,
    priceCents: 10500, depositCents: 2500,
  });
});

test('inverted or invalid appointment times fail safe with one minute', () => {
  assert.equal(appointmentToBookingService({ ...appointment, startsAt: 'bad' }).durationMin, 1);
  assert.equal(appointmentToBookingService({ ...appointment, endsAt: '2026-08-01T15:00:00Z' }).durationMin, 1);
});
