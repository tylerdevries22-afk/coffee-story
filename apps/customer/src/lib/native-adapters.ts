
import { TENANT } from '@/tenant';

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

/**
 * Takes the two fields it actually needs rather than a domain type: this used
 * to require a OrderableItem, which is why a calendar helper depended on the
 * booking module at all.
 */
export async function addOrderToCalendar(
  order: { summary: string; durationMin: number },
  pickupAt: string,
  isDemo: boolean,
  appOwnership: string | null,
): Promise<NativeFlowResult> {
  const date = new Date(pickupAt);
  if (Number.isNaN(date.getTime())) throw new Error('This order has an invalid pickup time.');
  if (usesSimulatedNativeFlows(isDemo, appOwnership)) {
    return { simulated: true, message: 'Calendar preview completed. No device calendar was changed.' };
  }
  const Calendar = await import('expo-calendar');
  const permission = await Calendar.requestCalendarPermissionsAsync();
  if (!permission.granted) throw new Error('Allow calendar access in Settings to add this order.');
  const calendar = await Calendar.getDefaultCalendarAsync();
  await Calendar.createEventAsync(calendar.id, {
    title: `${order.summary} at ${TENANT.identity.name}`,
    startDate: date,
    endDate: new Date(date.getTime() + order.durationMin * 60_000),
    timeZone: TENANT.location.timezone,
    location: `${TENANT.location.name}, ${TENANT.location.address.street}`,
    notes: `Your ${TENANT.identity.name} order is confirmed. See you at the bar.`,
    alarms: [{ relativeOffset: -60 }],
  });
  return { simulated: false, message: 'Your order is saved with a one-hour reminder.' };
}
