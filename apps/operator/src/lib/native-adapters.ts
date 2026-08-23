import { currentBusiness } from '@/data/business';
import type { BookingService } from '@/types/domain';

export type NativeFlowResult = {
  simulated: boolean;
  message: string;
};

export function shouldSimulateNativeFlow(isDemo: boolean, appOwnership: string | null): boolean {
  return isDemo || appOwnership === 'expo';
}

export function usesSimulatedNativeFlows(isDemo: boolean, appOwnership: string | null): boolean {
  return shouldSimulateNativeFlow(isDemo, appOwnership);
}

export async function addAppointmentToCalendar(
  service: BookingService,
  startsAt: string,
  isDemo: boolean,
  appOwnership: string | null,
): Promise<NativeFlowResult> {
  const date = new Date(startsAt);
  if (Number.isNaN(date.getTime())) throw new Error('This appointment has an invalid start time.');
  if (usesSimulatedNativeFlows(isDemo, appOwnership)) {
    return { simulated: true, message: 'Calendar preview completed. No device calendar was changed.' };
  }
  const Calendar = await import('expo-calendar');
  const permission = await Calendar.requestCalendarPermissionsAsync();
  if (!permission.granted) throw new Error('Allow calendar access in Settings to add this visit.');
  const calendar = await Calendar.getDefaultCalendarAsync();
  // The shop, not a shop: one binary per brand on the guest side and the
  // signed-in brand on the staff side. `America/Denver` was hard-coded here,
  // so a tenant in another zone had every pickup written to the wrong hour.
  const business = currentBusiness();
  await Calendar.createEventAsync(calendar.id, {
    title: `${service.name} at ${business.name}`,
    startDate: date,
    endDate: new Date(date.getTime() + service.durationMin * 60_000),
    timeZone: business.timezone,
    location: business.name,
    notes: `Your ${business.name} order is confirmed. See you at the bar.`,
    alarms: [{ relativeOffset: -60 }],
  });
  return { simulated: false, message: 'Your visit is saved with a one-hour reminder.' };
}
