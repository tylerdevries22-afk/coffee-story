// Staged replacement for src/components/rewards/glass-heart-palettes.ts
import type { RewardTierName } from '@/features/rewards/rules';
import { colors } from '@/theme/tokens';

export type GlassCupPalette = {
  liquidDeep: string;
  liquidMid: string;
  liquidLight: string;
  waveFront: string;
  waveBack: string;
  sparkle: string;
  foam: string;
  streamLight: string;
  streamDeep: string;
};

// Coffee liquid palettes — each tier is a different drink, lightening as the
// ladder climbs: milky latte → caramel → espresso → dark mocha with crema-gold
// glitter. Decorative hexes live here, not in theme tokens, because they exist
// only inside the glass vessel.
export const TIER_PALETTES: Record<RewardTierName, GlassCupPalette> = {
  'First Sip': {
    // Creamy latte
    liquidDeep: '#6B4A2F',
    liquidMid: '#96683F',
    liquidLight: '#C9A88C',
    waveFront: '#B38A63',
    waveBack: '#7D5A3C',
    sparkle: colors.white,
    foam: 'rgba(255,250,240,0.92)',
    streamLight: '#D8BC9C',
    streamDeep: '#96683F',
  },
  'Daily Ritual': {
    // Caramel
    liquidDeep: '#7A4E00',
    liquidMid: '#C08A1E',
    liquidLight: '#EFC356',
    waveFront: '#DBA83A',
    waveBack: '#8F5E08',
    sparkle: '#FFF7E0',
    foam: 'rgba(255,250,235,0.92)',
    streamLight: '#F5D077',
    streamDeep: '#C08A1E',
  },
  'House Regular': {
    // Espresso with crema sparkle
    liquidDeep: '#241208',
    liquidMid: '#4C3626',
    liquidLight: '#7D5A3C',
    waveFront: '#644631',
    waveBack: '#362518',
    sparkle: '#E8C48C',
    foam: 'rgba(243,234,224,0.9)',
    streamLight: '#9C7B57',
    streamDeep: '#4C3626',
  },
  'Coffee Legend': {
    // Dark mocha with gold glitter
    liquidDeep: '#170C05',
    liquidMid: '#33200F',
    liquidLight: '#5C3A1E',
    waveFront: '#472C15',
    waveBack: '#241308',
    sparkle: colors.gold300,
    foam: 'rgba(251,243,228,0.9)',
    streamLight: '#7D5A3C',
    streamDeep: '#33200F',
  },
};

/**
 * Tier names are owner-editable, so a lookup by name can miss. Falling back by
 * ladder position keeps a renamed or newly added tier looking deliberate rather
 * than rendering an empty glass, and keeps adjacent tiers visually distinct.
 */
const PALETTE_CYCLE: readonly GlassCupPalette[] = Object.values(TIER_PALETTES);

export function paletteForTier(name: string, ladderIndex?: number): GlassCupPalette {
  const exact = TIER_PALETTES[name];
  if (exact) return exact;
  if (ladderIndex !== undefined && Number.isFinite(ladderIndex)) {
    return PALETTE_CYCLE[Math.max(0, Math.trunc(ladderIndex)) % PALETTE_CYCLE.length];
  }
  // Stable per name where the caller has no ladder position: a renamed tier
  // keeps one colour across renders instead of flickering, and two custom
  // tiers usually land on different palettes.
  let hash = 0;
  for (let index = 0; index < name.length; index += 1) {
    hash = (hash * 31 + name.charCodeAt(index)) >>> 0;
  }
  return PALETTE_CYCLE[hash % PALETTE_CYCLE.length];
}
