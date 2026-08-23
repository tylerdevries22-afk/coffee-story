import { DEMO_PORTAL } from '@/data/demo';
import {
  fulfillmentDetail,
  fulfillmentLabel,
  type OrderFulfillment,
} from '@/features/order/fulfillment';
import type {
  BookingAddOn,
  BookingService,
  GiftCard,
  IntakeProfile,
  PortalAppointment,
  PortalBundle,
  PortalMessage,
  PortalProfile,
  RewardCatalogItem,
  AppRole,
} from '@/types/domain';

export type DemoBookingInput = {
  id: string;
  service: BookingService;
  addOns: BookingAddOn[];
  startsAt: string;
  fulfillment?: OrderFulfillment;
};

export const DEMO_STATE_VERSION = 4;

function clonePortal(portal: PortalBundle): PortalBundle {
  return JSON.parse(JSON.stringify(portal)) as PortalBundle;
}

export function createInitialDemoPortal(): PortalBundle {
  return migrateDemoPortalState(clonePortal(DEMO_PORTAL));
}

/** Add new persisted preferences without rejecting otherwise valid older demos. */
export function migrateDemoPortalState(portal: PortalBundle): PortalBundle {
  if (
    portal.demoStateVersion === DEMO_STATE_VERSION
    && typeof portal.autoPromptDismissed === 'boolean'
    && (typeof portal.profile.avatarUrl === 'string' || portal.profile.avatarUrl === null)
  ) {
    return portal;
  }
  return {
    ...portal,
    demoStateVersion: DEMO_STATE_VERSION,
    autoPromptDismissed: portal.autoPromptDismissed === true,
    profile: {
      ...portal.profile,
      avatarUrl: typeof portal.profile.avatarUrl === 'string' ? portal.profile.avatarUrl : null,
    },
  };
}

export function dismissDemoSetupAutoPrompt(portal: PortalBundle): PortalBundle {
  if (portal.autoPromptDismissed === true) return portal;
  return {
    ...portal,
    demoStateVersion: DEMO_STATE_VERSION,
    autoPromptDismissed: true,
  };
}

export function setDemoRole(portal: PortalBundle, role: AppRole): PortalBundle {
  return { ...portal, role };
}

export function isValidIsoSlot(value: string): boolean {
  return value.trim().length > 0 && !Number.isNaN(new Date(value).getTime());
}

export function demoSlotFor(date: string, timeLabel: string): string | null {
  const match = /^(\d{1,2}):(\d{2})\s(AM|PM)$/.exec(timeLabel);
  if (!match) return null;
  const hour = Number(match[1]) % 12 + (match[3] === 'PM' ? 12 : 0);
  const slot = new Date(`${date}T00:00:00`);
  if (Number.isNaN(slot.getTime())) return null;
  slot.setHours(hour, Number(match[2]), 0, 0);
  return slot.toISOString();
}

export function addDemoBooking(portal: PortalBundle, input: DemoBookingInput): PortalBundle {
  if (!isValidIsoSlot(input.startsAt)) throw new Error('Choose a valid appointment time.');
  const addOnCents = input.addOns.reduce((total, addOn) => total + addOn.priceCents, 0);
  const addOnMinutes = input.addOns.reduce((total, addOn) => total + addOn.durationMin, 0);
  const subtotalCents = input.service.priceCents + addOnCents;
  const appointment: PortalAppointment = {
    id: input.id,
    serviceName: input.addOns.length
      ? `${input.service.name} + ${input.addOns.map((addOn) => addOn.name).join(', ')}`
      : input.service.name,
    startsAt: input.startsAt,
    endsAt: new Date(
      new Date(input.startsAt).getTime() + (input.service.durationMin + addOnMinutes) * 60_000,
    ).toISOString(),
    status: 'confirmed',
    subtotalCents,
    depositCents: input.service.depositCents,
    balanceCents: subtotalCents - input.service.depositCents,
    fulfillmentMode: input.fulfillment?.mode,
    locationLabel: input.fulfillment ? fulfillmentLabel(input.fulfillment) : undefined,
    locationDetail: input.fulfillment ? fulfillmentDetail(input.fulfillment) : undefined,
  };
  return { ...portal, appointments: [appointment, ...portal.appointments] };
}

export function cancelDemoAppointment(portal: PortalBundle, appointmentId: string): PortalBundle {
  return {
    ...portal,
    appointments: portal.appointments.map((appointment) => (
      appointment.id === appointmentId ? { ...appointment, status: 'cancelled' } : appointment
    )),
  };
}

/**
 * Records a post-visit review on a demo appointment.
 *
 * Without this the demo branch of `saveVisitReview` persisted nothing while
 * still alerting "Review saved" -- the same fake-success shape already fixed for
 * staff block-time and SOAP notes. Rating is clamped to the 1-5 range the UI
 * offers so a caller cannot store an out-of-range score.
 */
export function reviewDemoAppointment(
  portal: PortalBundle,
  appointmentId: string,
  rating: number,
  note: string,
  submittedAt: string,
): PortalBundle {
  const clamped = Math.min(Math.max(Math.round(rating), 1), 5);
  return {
    ...portal,
    appointments: portal.appointments.map((appointment) => (
      appointment.id === appointmentId
        ? { ...appointment, review: { rating: clamped, note: note.trim(), submittedAt } }
        : appointment
    )),
  };
}

export function rescheduleDemoAppointment(
  portal: PortalBundle,
  appointmentId: string,
  startsAt: string,
): PortalBundle {
  if (!isValidIsoSlot(startsAt)) throw new Error('Choose a valid appointment time.');
  return {
    ...portal,
    appointments: portal.appointments.map((appointment) => {
      if (appointment.id !== appointmentId) return appointment;
      const duration = new Date(appointment.endsAt).getTime() - new Date(appointment.startsAt).getTime();
      return {
        ...appointment,
        startsAt,
        endsAt: new Date(new Date(startsAt).getTime() + duration).toISOString(),
        status: 'confirmed',
      };
    }),
  };
}

export function redeemDemoReward(
  portal: PortalBundle,
  reward: RewardCatalogItem,
  ledgerId: string,
  earnedAt: string,
): PortalBundle {
  if (reward.pointsCost > portal.rewardAccount.availablePoints) {
    throw new Error('You do not have enough points for this reward.');
  }
  const creditMatch = /\$(\d+)/.exec(reward.name);
  const cashCents = creditMatch ? Number(creditMatch[1]) * 100 : 0;
  return {
    ...portal,
    rewardAccount: {
      ...portal.rewardAccount,
      availablePoints: portal.rewardAccount.availablePoints - reward.pointsCost,
      cashCents: portal.rewardAccount.cashCents + cashCents,
    },
    rewardLedger: [{
      id: ledgerId,
      entryType: 'redemption',
      points: -reward.pointsCost,
      description: `Redeemed ${reward.name}`,
      earnedAt,
      expiresAt: null,
    }, ...portal.rewardLedger],
  };
}

const ACTIVITY_POINTS: Readonly<Record<string, number>> = {
  share_experience: 30,
  refer_friend: 20,
  add_birthday: 5,
  complete_intake: 10,
  google_review: 5,
  enable_reminders: 5,
};

export function completeDemoRewardActivity(
  portal: PortalBundle,
  activityKey: string,
  ledgerId: string,
  earnedAt: string,
): PortalBundle {
  if (portal.rewardActivities.includes(activityKey)) return portal;
  const points = ACTIVITY_POINTS[activityKey];
  if (!points) throw new Error('This activity is not eligible for points.');
  return {
    ...portal,
    rewardActivities: [...portal.rewardActivities, activityKey],
    rewardAccount: {
      ...portal.rewardAccount,
      availablePoints: portal.rewardAccount.availablePoints + points,
      annualPoints: portal.rewardAccount.annualPoints + points,
    },
    rewardLedger: [{
      id: ledgerId,
      entryType: 'activity',
      points,
      description: activityKey.replaceAll('_', ' '),
      earnedAt,
      expiresAt: new Date(new Date(earnedAt).setFullYear(new Date(earnedAt).getFullYear() + 1)).toISOString(),
    }, ...portal.rewardLedger],
  };
}

export function addDemoGift(portal: PortalBundle, gift: GiftCard): PortalBundle {
  return { ...portal, giftCards: [gift, ...portal.giftCards] };
}

export function updateDemoProfile(portal: PortalBundle, profile: PortalProfile): PortalBundle {
  return { ...portal, profile: { ...profile, fullName: profile.fullName.trim(), email: profile.email.trim() } };
}

export function updateDemoIntake(portal: PortalBundle, intake: IntakeProfile): PortalBundle {
  return { ...portal, intake };
}

export function addDemoMessage(portal: PortalBundle, message: PortalMessage): PortalBundle {
  return { ...portal, messages: [...(portal.messages ?? []), message] };
}

export function removeDemoPaymentMethod(portal: PortalBundle, methodId: string): PortalBundle {
  const remaining = (portal.paymentMethods ?? []).filter((method) => method.id !== methodId);
  return {
    ...portal,
    paymentMethods: remaining.map((method, index) => ({ ...method, isDefault: index === 0 })),
  };
}

export function setDemoMembershipStatus(
  portal: PortalBundle,
  status: 'active' | 'paused' | 'cancelled',
): PortalBundle {
  return portal.membership ? { ...portal, membership: { ...portal.membership, status } } : portal;
}
