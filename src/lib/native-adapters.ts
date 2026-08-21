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
  await Calendar.createEventAsync(calendar.id, {
    title: `${service.name} at Coffee Story`,
    startDate: date,
    endDate: new Date(date.getTime() + service.durationMin * 60_000),
    timeZone: 'America/Denver',
    location: 'Coffee Story',
    notes: 'Your massage visit is confirmed. Please arrive a few minutes early.',
    alarms: [{ relativeOffset: -60 }],
  });
  return { simulated: false, message: 'Your visit is saved with a one-hour reminder.' };
}
