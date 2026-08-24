import type { KioskUtility } from '@platform/domain';

export type UtilityContent = {
  label: string;
  title: string;
  message: string;
};

const CONTENT: Record<KioskUtility, UtilityContent> = {
  rewards: {
    label: 'Rewards',
    title: 'Rewards at this kiosk',
    message: 'This kiosk cannot sign in to or redeem a rewards account yet. A team member can help at the counter.',
  },
  giftBalance: {
    label: 'Check gift card',
    title: 'Gift card balance',
    message: 'This kiosk cannot check or redeem a gift card balance yet. A team member can help at the counter.',
  },
  allergens: {
    label: 'Allergy & nutrition',
    title: 'Before you order',
    message: 'Ingredient and allergen details are not available on this kiosk. Recipes and shared equipment can change, so please speak with a team member before ordering.',
  },
};

/** Honest, guest-facing copy for every utility the tenant may configure. */
export function utilityContentFor(utility: KioskUtility): UtilityContent {
  return CONTENT[utility];
}
