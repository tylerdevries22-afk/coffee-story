import birthdayCake from '../../assets/gift/birthday-cake.webp';
import birthdayConfetti from '../../assets/gift/birthday-confetti.webp';
import congratsBloom from '../../assets/gift/congrats-bloom.webp';
import congratsGold from '../../assets/gift/congrats-gold.webp';
import grateful from '../../assets/gift/grateful.webp';
import healingOil from '../../assets/gift/healing-oil.webp';
import quietHour from '../../assets/gift/quiet-hour.webp';
import thankYou from '../../assets/gift/thank-you.webp';

import { TENANT } from '@/tenant';

export type GiftDesign = {
  /** Persisted on the gift card, so these keys must stay stable. */
  key: string;
  name: string;
  art: number;
};

export type GiftDesignCategory = {
  title: string;
  designs: readonly GiftDesign[];
};

/**
 * The gift-card artwork, grouped into the shelves the Gift tab renders.
 *
 * Order matters: the first shelf is what a member sees without scrolling.
 */
export const GIFT_DESIGN_CATEGORIES: readonly GiftDesignCategory[] = [
  {
    title: 'Featured',
    designs: [
      { key: 'quiet-hour', name: 'Slow Morning', art: quietHour },
      { key: 'healing', name: 'A Blessing In Every Cup', art: healingOil },
    ],
  },
  {
    title: 'Birthday',
    designs: [
      { key: 'birthday', name: 'Happy Birthday', art: birthdayConfetti },
      { key: 'birthday-softer', name: 'Birthday Brew', art: birthdayCake },
    ],
  },
  {
    title: 'Congratulations',
    designs: [
      { key: 'congratulations', name: 'Congratulations', art: congratsGold },
      { key: 'well-done', name: 'Well Done', art: congratsBloom },
    ],
  },
  {
    title: 'Appreciation',
    designs: [
      { key: 'thank-you', name: 'Thank You', art: thankYou },
      { key: 'grateful', name: 'Grateful For You', art: grateful },
    ],
  },
];

export const ALL_GIFT_DESIGNS: readonly GiftDesign[] = GIFT_DESIGN_CATEGORIES.flatMap(
  (category) => category.designs,
);

export function giftDesignByKey(key: string): GiftDesign | undefined {
  return ALL_GIFT_DESIGNS.find((design) => design.key === key);
}

/** Preset load amounts offered on the purchase sheet. */
export const GIFT_AMOUNTS = [10, 15, 25, 50, 75, 100] as const;

/** Quantities offered on the purchase sheet. */
export const GIFT_QUANTITIES = [1, 2, 3, 4, 5] as const;

export type GiftFaq = { question: string; answer: string };

export const GIFT_FAQS: readonly GiftFaq[] = [
  {
    question: `Do ${TENANT.identity.name} gift cards expire?`,
    answer:
      'No. Digital gift cards hold their balance indefinitely and never lose value over time.',
  },
  {
    question: 'How do I check my gift card balance?',
    answer:
      'Open the Gift tab and choose My Gift Cards. Each card shows its remaining balance and full redemption history.',
  },
  {
    question: 'How long does it take for someone to receive a digital gift card?',
    answer:
      'Sent immediately, it arrives within a few minutes. If you schedule a delivery date it sends at 9am local time that day.',
  },
  {
    question: 'Can I send a digital gift card by email?',
    answer:
      'Yes. Send it from My Gift Cards and the recipient gets a secure claim link they can open on any device.',
  },
  {
    question: 'Can I use a gift card toward anything on the menu?',
    answer:
      'Yes — drinks, boba, desserts, sandwiches, and add-ons. The balance applies at checkout and anything left over stays on the card.',
  },
  {
    question: "The gift card I sent wasn't received. What should I do?",
    answer:
      'Check the spam folder first, then resend from My Gift Cards. The claim link stays valid until it is used.',
  },
];
