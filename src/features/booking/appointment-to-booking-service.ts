import type { BookingService, PortalAppointment } from '@/types/domain';

export function appointmentToBookingService(appointment: PortalAppointment): BookingService {
  const startsAt = new Date(appointment.startsAt).getTime();
  const endsAt = new Date(appointment.endsAt).getTime();
  const durationMin = Number.isFinite(startsAt) && Number.isFinite(endsAt)
    ? Math.max(1, Math.round((endsAt - startsAt) / 60_000))
    : 1;
  return {
    slug: appointment.id,
    name: appointment.serviceName,
    category: 'signature',
    durationMin,
    priceCents: appointment.subtotalCents,
    depositCents: appointment.depositCents,
  };
}
