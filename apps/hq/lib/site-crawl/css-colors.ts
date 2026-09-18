/**
 * A site's own colours, read from its theme colour and CSS custom properties.
 *
 * Custom properties are where a site builder or theme records a brand
 * palette by name (`--brand-primary`, `--e-global-color-accent`, a theme's
 * `--wp--preset--color--primary`), so they are the most deliberate colour
 * statement a stylesheet makes. WordPress core ships the same dozen preset
 * colours into every site, which say nothing about the business and are
 * skipped by name. Every value is normalised to `#RRGGBB`, and near-greys are
 * kept but ranked after real hues, because a palette of white and black is
 * rarely the brand.
 */
export type ColorCandidate = {
  readonly hex: string;
  readonly names: readonly string[];
  readonly uses: number;
  readonly neutral: boolean;
};

const DECLARATION = /--([a-z0-9_-]{1,80})\s*:\s*([^;{}]{1,120})/gi;
const HEX_VALUE = /^#([0-9a-f]{3,8})$/;
const FUNCTION_VALUE = /^(rgba?|hsla?)\((.*)\)$/;
const WORDPRESS_CORE = /^wp--preset--color--(?:black|white|cyan-bluish-gray|pale-pink|vivid-red|luminous-vivid-orange|luminous-vivid-amber|light-green-cyan|vivid-green-cyan|pale-cyan-blue|vivid-cyan-blue|vivid-purple)$/;
const BRAND_NAME = /primary|brand|accent|secondary|main|theme|highlight|cta|button|link/;
const VAR_REFERENCE = /^var\(\s*--([a-z0-9_-]+)\s*(?:,\s*([^)]*))?\)$/i;
const MAX_CANDIDATES = 12;

type Rgb = readonly [number, number, number];

function toHex([red, green, blue]: Rgb): string {
  return `#${[red, green, blue].map((channel) => Math.round(channel).toString(16).padStart(2, '0')).join('').toUpperCase()}`;
}

function channel(token: string, scale: number): number | null {
  const value = token.endsWith('%') ? (Number(token.slice(0, -1)) / 100) * scale : Number(token);
  return Number.isFinite(value) ? Math.min(scale, Math.max(0, value)) : null;
}

function hslToRgb(hue: number, saturation: number, lightness: number): Rgb {
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const sector = (((hue % 360) + 360) % 360) / 60;
  const second = chroma * (1 - Math.abs((sector % 2) - 1));
  const [r, g, b]: Rgb = sector < 1 ? [chroma, second, 0] : sector < 2 ? [second, chroma, 0] : sector < 3 ? [0, chroma, second]
    : sector < 4 ? [0, second, chroma] : sector < 5 ? [second, 0, chroma] : [chroma, 0, second];
  const lift = lightness - chroma / 2;
  return [(r + lift) * 255, (g + lift) * 255, (b + lift) * 255];
}

/** A CSS colour value as `#RRGGBB`, or null for anything that is not a solid colour. */
export function normalizeCssColor(raw: string): string | null {
  const value = raw.replace(/!important/i, '').trim().toLowerCase();
  const hex = HEX_VALUE.exec(value)?.[1];
  if (hex !== undefined) {
    if (hex.length === 5 || hex.length === 7) return null;
    const full = hex.length <= 4 ? [...hex].map((digit) => digit + digit).join('') : hex;
    // A mostly transparent colour is an overlay, not a brand colour.
    if (full.length === 8 && Number.parseInt(full.slice(6, 8), 16) < 128) return null;
    return `#${full.slice(0, 6).toUpperCase()}`;
  }
  const call = FUNCTION_VALUE.exec(value);
  if (!call?.[1] || call[2] === undefined) return null;
  const parts = call[2].split(/[\s,/]+/).filter(Boolean);
  if (parts.length < 3) return null;
  const alphaToken = parts[3];
  const alpha = alphaToken === undefined ? 1 : channel(alphaToken, 1);
  if (alpha === null || alpha < 0.5) return null;
  if (call[1].startsWith('rgb')) {
    const [red, green, blue] = parts.slice(0, 3).map((part) => channel(part, 255));
    if (red === null || red === undefined || green === null || green === undefined || blue === null || blue === undefined) return null;
    return toHex([red, green, blue]);
  }
  const hue = Number.parseFloat(parts[0] ?? '');
  const saturation = channel(parts[1] ?? '', 1);
  const lightness = channel(parts[2] ?? '', 1);
  if (!Number.isFinite(hue) || saturation === null || lightness === null) return null;
  return toHex(hslToRgb(hue, saturation, lightness));
}

/** True for whites, blacks and greys: too little hue to say anything about a brand. */
export function isNeutralColor(hex: string): boolean {
  const channels = [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255);
  const max = Math.max(...channels);
  const min = Math.min(...channels);
  const lightness = (max + min) / 2;
  const saturation = max === min ? 0 : (max - min) / (1 - Math.abs(2 * lightness - 1));
  return saturation < 0.12 || lightness > 0.96 || lightness < 0.05;
}

/**
 * Every custom property declared in `stylesheets`, first declaration winning,
 * with `var(--other)` references followed a few steps -- themes commonly
 * alias a brand name to a palette step (`--primary: var(--blue-600)`).
 */
function declaredColors(stylesheets: readonly string[]): Map<string, string | null> {
  const declared = new Map<string, string>();
  for (const css of stylesheets) {
    for (const match of css.matchAll(DECLARATION)) {
      const name = (match[1] ?? '').toLowerCase();
      if (!declared.has(name)) declared.set(name, (match[2] ?? '').trim());
    }
  }
  const resolve = (value: string, depth: number): string | null => {
    const reference = VAR_REFERENCE.exec(value);
    if (reference === null) return normalizeCssColor(value);
    const target = declared.get((reference[1] ?? '').toLowerCase());
    if (target !== undefined && depth < 4) return resolve(target, depth + 1);
    return reference[2] === undefined ? null : normalizeCssColor(reference[2]);
  };
  const colors = new Map<string, string | null>();
  for (const [name, value] of declared) colors.set(name, resolve(value, 0));
  return colors;
}

/**
 * Ranked colour candidates: the declared theme colour first, then properties
 * whose names say "brand", then by how many properties hold the colour.
 */
export function paletteCandidates(themeColors: readonly string[], stylesheets: readonly string[]): ColorCandidate[] {
  const found = new Map<string, { names: Set<string>; uses: number; weight: number }>();
  const note = (hex: string | null, name: string, weight: number): void => {
    if (hex === null) return;
    const entry = found.get(hex) ?? { names: new Set<string>(), uses: 0, weight: 0 };
    entry.names.add(name);
    entry.uses += 1;
    entry.weight += weight;
    found.set(hex, entry);
  };
  for (const color of themeColors) note(normalizeCssColor(color), 'theme-color', 10);
  for (const [name, hex] of declaredColors(stylesheets)) {
    if (!WORDPRESS_CORE.test(name)) note(hex, `--${name}`, BRAND_NAME.test(name) ? 5 : 1);
  }
  return [...found.entries()]
    .map(([hex, entry]) => ({ hex, names: [...entry.names].slice(0, 4), uses: entry.uses, neutral: isNeutralColor(hex), weight: entry.weight }))
    .sort((a, b) => Number(a.neutral) - Number(b.neutral) || b.weight - a.weight || b.uses - a.uses)
    .slice(0, MAX_CANDIDATES)
    .map(({ hex, names, uses, neutral }) => ({ hex, names, uses, neutral }));
}
