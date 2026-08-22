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
  motion: { fast: number; base: number; slow: number };
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
  motion: { fast: 120, base: 220, slow: 360 },
};

const HEX = /^#[0-9a-fA-F]{6}$/;

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
  for (const group of ['radius', 'spacing', 'motion'] as const) {
    const value = source[group];
    if (typeof value !== 'object' || value === null) continue;
    const target = tokens[group] as Record<string, number>;
    for (const [k, v] of Object.entries(value)) {
      if (k in target && typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1000) {
        target[k] = v;
      }
    }
  }
  return tokens;
}
