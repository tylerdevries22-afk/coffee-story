/* eslint-disable import/no-unresolved -- Metro resolves @tenant-bundle to one validated tenant. */
import { TENANT_MENU_MEDIA } from '@tenant-bundle/generated/menu-media';
import { BUNDLED_CUTOUTS } from '@tenant-bundle/generated/product-media';
import brandLogo from '@tenant-bundle/artwork/brand/logo.png';
import birthdayCake from '@tenant-bundle/artwork/gift/birthday-cake.webp';
import birthdayConfetti from '@tenant-bundle/artwork/gift/birthday-confetti.webp';
import congratsBloom from '@tenant-bundle/artwork/gift/congrats-bloom.webp';
import congratsGold from '@tenant-bundle/artwork/gift/congrats-gold.webp';
import grateful from '@tenant-bundle/artwork/gift/grateful.webp';
import healingOil from '@tenant-bundle/artwork/gift/healing-oil.webp';
import quietHour from '@tenant-bundle/artwork/gift/quiet-hour.webp';
import thankYou from '@tenant-bundle/artwork/gift/thank-you.webp';
import homeHero from '@tenant-bundle/artwork/hero/home-hero.mp4';
import stones from '@tenant-bundle/artwork/hero/stones.webp';
import liquidNebula from '@tenant-bundle/artwork/rewards/liquid-nebula.webp';

export type TenantMediaSlot = {
  readonly brandLogo: number;
  readonly artwork: Readonly<Record<string, number>>;
  readonly menuMedia: Readonly<Record<string, number>>;
  readonly productMedia: Readonly<Record<string, number>>;
};

export const TENANT_MEDIA: TenantMediaSlot = {
  brandLogo,
  artwork: {
    'gift/birthday-cake.webp': birthdayCake,
    'gift/birthday-confetti.webp': birthdayConfetti,
    'gift/congrats-bloom.webp': congratsBloom,
    'gift/congrats-gold.webp': congratsGold,
    'gift/grateful.webp': grateful,
    'gift/healing-oil.webp': healingOil,
    'gift/quiet-hour.webp': quietHour,
    'gift/thank-you.webp': thankYou,
    'hero/home-hero.mp4': homeHero,
    'hero/stones.webp': stones,
    'rewards/liquid-nebula.webp': liquidNebula,
  },
  menuMedia: TENANT_MENU_MEDIA,
  productMedia: BUNDLED_CUTOUTS,
};
