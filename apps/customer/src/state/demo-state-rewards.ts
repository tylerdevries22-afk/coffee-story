import type {
  GiftCard,
  GuestPreferences,
  PortalBundle,
  PortalMessage,
  PortalProfile,
  RewardCatalogItem,
} from '@platform/domain';

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

export function updateDemoIntake(portal: PortalBundle, preferences: GuestPreferences): PortalBundle {
  return { ...portal, preferences };
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
