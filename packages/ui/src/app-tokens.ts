import { resolveFontFace } from './font-registry';
import { resolveTokens, type BrandTokens } from './tokens';

const HEX = /^#[0-9a-fA-F]{6}$/;

export const APP_COLOR_KEYS = [
  'successTint', 'warningTint', 'dangerTint', 'liveGlow',
  'brand50', 'brand100', 'brand200', 'brand300', 'brand400', 'brand500',
  'brand600', 'brand700', 'brand800', 'brand900',
  'gold50', 'gold300', 'gold400', 'gold500',
  'ink900', 'ink700', 'ink600', 'ink500', 'ink400', 'ink300', 'ink200',
  'white', 'surface', 'warm', 'success', 'warning', 'danger',
  'siriCyan', 'siriBlue', 'siriPurple', 'siriPink',
] as const;

export type AppColorName = (typeof APP_COLOR_KEYS)[number];

export type AppColors = Record<AppColorName, string>;

export type AppTokens = {
  colors: AppColors;
  radius: BrandTokens['radius'] & { xl: number };
  spacing: BrandTokens['spacing'];
  scrim: { color: string; opacity: number };
  motion: { enterMs: number; exitMs: number };
  shadow: {
    card: {
      shadowColor: string;
      shadowOffset: { width: number; height: number };
      shadowOpacity: number;
      shadowRadius: number;
      elevation: number;
    };
  };
  fonts: { sans: string; sansMedium: string; sansBold: string; display: string };
};

function rgb(color: string): [number, number, number] {
  return [
    Number.parseInt(color.slice(1, 3), 16),
    Number.parseInt(color.slice(3, 5), 16),
    Number.parseInt(color.slice(5, 7), 16),
  ];
}

function hexChannel(channel: number): string {
  return Math.round(channel).toString(16).padStart(2, '0').toUpperCase();
}

/** Mixes two validated six-digit hex colours; weight is the share of `to`. */
export function mixHex(from: string, to: string, weight: number): string {
  if (!HEX.test(from) || !HEX.test(to)) throw new RangeError('mixHex expects #RRGGBB colours.');
  if (!Number.isFinite(weight)) throw new RangeError('mixHex weight must be finite.');
  const bounded = Math.min(1, Math.max(0, weight));
  const start = rgb(from);
  const end = rgb(to);
  return `#${start.map((value, index) => hexChannel(value + ((end[index] ?? value) - value) * bounded)).join('')}`;
}

/**
 * The divider, derived rather than drawn.
 *
 * Screens had been spelling this out as `rgba(70,48,78,0.12)` -- one brand's
 * plum ink at twelve percent, pasted into seven files. It is the same line
 * `ink200` already computes, so it is the same mix here: brand ink laid on the
 * raised surface at the weight where a hairline reads as a line and not a bar.
 * A brand with black ink gets a grey line; a brand with plum ink gets a plum
 * one, which is what the literal was quietly assuming everyone had.
 */
export function hairline(tokens: Pick<BrandTokens, 'surfaceElevated' | 'textPrimary'>): string {
  return mixHex(tokens.surfaceElevated, tokens.textPrimary, 0.16);
}

/**
 * A token colour at a stated opacity.
 *
 * Screens reach for translucency constantly -- a scrim over a sheet, the wash
 * a web glass bar falls back to, the gradient that keeps white type legible
 * over a photograph -- and every one of those had been written as an `rgba()`
 * with one brand's ink typed into it. The colour is not the decision there;
 * the opacity is. This keeps the opacity in the screen and takes the colour
 * from the tenant, which is the whole of rule 4 for these cases.
 *
 * Eight-digit hex rather than `rgba()`: React Native and react-native-web both
 * parse `#RRGGBBAA`, so one string serves both targets and the value stays a
 * token the ramp can still override.
 */
export function alpha(color: string, opacity: number): string {
  if (!HEX.test(color)) throw new RangeError('alpha expects a #RRGGBB colour.');
  if (!Number.isFinite(opacity)) throw new RangeError('alpha opacity must be finite.');
  return `${color}${hexChannel(Math.min(1, Math.max(0, opacity)) * 255)}`;
}

function derivedColors(tokens: BrandTokens): AppColors {
  const lightBrand = tokens.surface;
  const darkBrand = tokens.primary;
  const lightInk = tokens.surfaceElevated;
  const darkInk = tokens.textPrimary;
  return {
    successTint: mixHex(tokens.surfaceElevated, tokens.success, 0.12),
    warningTint: mixHex(tokens.surfaceElevated, tokens.warning, 0.12),
    dangerTint: mixHex(tokens.surfaceElevated, tokens.danger, 0.12),
    liveGlow: mixHex(tokens.success, tokens.surfaceElevated, 0.28),
    brand50: mixHex(lightBrand, darkBrand, 0.02),
    brand100: mixHex(lightBrand, darkBrand, 0.08),
    brand200: mixHex(lightBrand, darkBrand, 0.18),
    brand300: mixHex(lightBrand, darkBrand, 0.34),
    brand400: mixHex(lightBrand, darkBrand, 0.5),
    brand500: mixHex(lightBrand, darkBrand, 0.66),
    brand600: mixHex(lightBrand, darkBrand, 0.76),
    brand700: mixHex(lightBrand, darkBrand, 0.84),
    brand800: mixHex(lightBrand, darkBrand, 0.92),
    brand900: darkBrand,
    gold50: mixHex(tokens.surfaceElevated, tokens.accent, 0.08),
    gold300: mixHex(tokens.surfaceElevated, tokens.accent, 0.42),
    gold400: mixHex(tokens.surfaceElevated, tokens.accent, 0.64),
    gold500: tokens.accent,
    ink900: darkInk,
    ink700: mixHex(lightInk, darkInk, 0.82),
    ink600: mixHex(lightInk, darkInk, 0.7),
    ink500: tokens.textMuted,
    ink400: mixHex(lightInk, darkInk, 0.48),
    ink300: mixHex(lightInk, darkInk, 0.3),
    ink200: mixHex(lightInk, darkInk, 0.16),
    white: tokens.surfaceElevated,
    surface: tokens.surface,
    warm: mixHex(tokens.surface, tokens.accent, 0.03),
    success: tokens.success,
    warning: tokens.warning,
    danger: tokens.danger,
    siriCyan: '#5FD4F5',
    siriBlue: '#5E8CF0',
    siriPurple: '#9D6BF5',
    siriPink: '#F27AC2',
  };
}

function rampOf(config: unknown): Record<string, unknown> {
  if (typeof config !== 'object' || config === null) return {};
  const ramp = (config as Record<string, unknown>).ramp;
  return typeof ramp === 'object' && ramp !== null ? ramp as Record<string, unknown> : {};
}

/** Resolves the full legacy app palette from tenant seed tokens and overrides. */
export function resolveAppTokens(config: unknown): AppTokens {
  const tokens = resolveTokens(config);
  const colors = derivedColors(tokens);
  const ramp = rampOf(config);
  for (const key of APP_COLOR_KEYS) {
    const value = ramp[key];
    if (typeof value === 'string' && HEX.test(value)) colors[key] = value;
  }
  return {
    colors,
    radius: { ...tokens.radius, xl: Math.round(tokens.radius.lg * 1.31) },
    spacing: { ...tokens.spacing },
    scrim: { color: colors.brand900, opacity: 0.45 },
    motion: { enterMs: Math.min(tokens.motion.slow, tokens.motion.base + 60), exitMs: tokens.motion.base },
    shadow: {
      card: {
        shadowColor: colors.brand900,
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: tokens.elevation.card,
        shadowRadius: 24,
        elevation: 5,
      },
    },
    fonts: {
      sans: resolveFontFace(tokens.fontBody, 400),
      sansMedium: resolveFontFace(tokens.fontBody, 600),
      sansBold: resolveFontFace(tokens.fontBody, 700),
      display: resolveFontFace(tokens.fontDisplay, 700),
    },
  };
}
