/**
 * Design tokens (rule 4): the only place a color, font, radius, spacing step,
 * or motion duration may come from. Components read them through `useTokens`;
 * the values are hydrated per tenant from `brand_config` (see theme.tsx).
 *
 * The defaults below are a neutral, deliberately plain fallback -- visible
 * long enough to hydrate and nothing more. They are NOT a brand.
 */
export type BrandTokens = {
  /** Ink-on-light primary action + brand mark color. */
  primary: string;
  /** Supporting brand color for secondary surfaces and lines. */
  secondary: string;
  /** The page ground. */
  surface: string;
  /** Cards and sheets that float above the ground. */
  surfaceElevated: string;
  /** The brand's highlight -- price deltas, live badges, the drop ring. */
  accent: string;
  textPrimary: string;
  textMuted: string;
  success: string;
  warning: string;
  danger: string;
  radius: { sm: number; md: number; lg: number; pill: number };
  spacing: { xs: number; sm: number; md: number; lg: number; xl: number; xxl: number };
  /** Font family names; loading the files is the app's job. */
  fontDisplay: string;
  fontBody: string;
  /**
   * Durations in ms. `fast`/`base`/`slow` are the furniture (docs/DESIGN.md);
   * the rest exist because the kiosk animates and a magic number in a screen
   * is exactly what rule 4 forbids.
   */
  motion: {
    fast: number; base: number; slow: number;
    /** Per-item delay in a staggered entrance. */
    stagger: number;
    /** Press-in. Shorter than `fast`: a tap that lags reads as a dropped tap. */
    press: number;
    /** The one long beat -- a placed order, a drawn check. */
    celebrate: number;
  };
  /** Shadow opacity, not a blur radius. A 0-1 fraction. */
  elevation: { card: number; raised: number };
  /**
   * One type ladder, and each surface picks its rungs from it.
   *
   * Sizes were hard-coded numerals inside every component before this -- 16 in
   * ItemCard, 96 and 220 in the kiosk -- so "the kiosk's body is 20pt where the
   * phone's is 16" (docs/FIVE-SURFACES.md) could not be expressed as one
   * decision read at two distances. It is deliberately NOT a per-surface
   * multiplier: a factor applied to a whole ladder drags the display sizes with
   * it and lands on values nobody chose. Rungs are named by size, not by role,
   * because the same rung is body on a kiosk and a title on a phone.
   *
   * phone  body md, label sm, title xxl
   * kiosk  body lg, label xl, question hero, attract mega
   * board  ticket
   */
  type: {
    xs: number; sm: number; md: number; lg: number; xl: number;
    xxl: number; display: number; hero: number; mega: number;
    /** The one number a guest reads while walking away. */
    ticket: number;
  };
};

export const DEFAULT_TOKENS: BrandTokens = {
  primary: '#1C1917',
  secondary: '#44403C',
  surface: '#FAFAF9',
  surfaceElevated: '#FFFFFF',
  accent: '#8A7350',
  textPrimary: '#1C1917',
  textMuted: '#57534E',
  success: '#2F6844',
  warning: '#8A5A1E',
  danger: '#9B3B32',
  radius: { sm: 8, md: 14, lg: 22, pill: 999 },
  spacing: { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 },
  fontDisplay: 'System',
  fontBody: 'System',
  motion: { fast: 120, base: 220, slow: 360, stagger: 40, press: 90, celebrate: 620 },
  elevation: { card: 0.08, raised: 0.16 },
  type: { xs: 12, sm: 14, md: 16, lg: 20, xl: 24, xxl: 30, display: 40, hero: 56, mega: 80, ticket: 180 },
};

const HEX = /^#[0-9a-fA-F]{6}$/;

const NUMERIC_GROUPS = ['radius', 'spacing', 'motion', 'elevation', 'type'] as const;

/** An upper bound per group, in that group's own unit. */
const GROUP_MAX: Record<(typeof NUMERIC_GROUPS)[number], number> = {
  radius: 1000, spacing: 1000, motion: 1000, type: 1000,
  // A shadow opacity is a fraction.
  elevation: 1,
};

const COLOR_KEYS = [
  'primary', 'secondary', 'surface', 'surfaceElevated', 'accent',
  'textPrimary', 'textMuted', 'success', 'warning', 'danger',
] as const;

/**
 * Merges a tenant's (untrusted, possibly partial or malformed) token config
 * over the defaults. Bad values are dropped field by field rather than
 * rejecting the whole config: a typo in `warning` should not unbrand the app.
 */
export function resolveTokens(config: unknown): BrandTokens {
  const tokens: BrandTokens = {
    ...DEFAULT_TOKENS,
    radius: { ...DEFAULT_TOKENS.radius },
    spacing: { ...DEFAULT_TOKENS.spacing },
    motion: { ...DEFAULT_TOKENS.motion },
    elevation: { ...DEFAULT_TOKENS.elevation },
    type: { ...DEFAULT_TOKENS.type },
  };
  if (typeof config !== 'object' || config === null) return tokens;
  const source = config as Record<string, unknown>;

  for (const key of COLOR_KEYS) {
    const value = source[key];
    if (typeof value === 'string' && HEX.test(value)) tokens[key] = value;
  }
  for (const key of ['fontDisplay', 'fontBody'] as const) {
    const value = source[key];
    if (typeof value === 'string' && value.length > 0 && value.length < 64) tokens[key] = value;
  }
  for (const group of NUMERIC_GROUPS) {
    const value = source[group];
    if (typeof value !== 'object' || value === null) continue;
    const target = tokens[group] as Record<string, number>;
    // Per-group, because one shared ceiling of 1000 would accept an
    // `elevation.card` of 500 and paint an opaque black slab over the card it
    // was supposed to lift.
    const max = GROUP_MAX[group];
    for (const [k, v] of Object.entries(value)) {
      if (k in target && typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= max) {
        target[k] = v;
      }
    }
  }
  return tokens;
}
