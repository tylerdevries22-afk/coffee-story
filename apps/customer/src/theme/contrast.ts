/**
 * WCAG relative luminance and contrast, for asserting the palette.
 *
 * The workspace surfaces are pale plum washes rather than the near-black they
 * used to be, and a token that was comfortable on dark can land just under the
 * threshold on pale without looking wrong to anyone reading the diff. `ink500`
 * on `brand100` measured 4.36:1 — legible, plausible, and failing.
 *
 * Pure arithmetic so contrast.test.ts can hold the palette to a number instead
 * of an opinion.
 */

/** Parses `#RGB` or `#RRGGBB` into 0-255 components. */
export function parseHex(color: string): [number, number, number] {
  const hex = color.replace('#', '').trim();
  const full = hex.length === 3 ? hex.split('').map((c) => c + c).join('') : hex;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) throw new RangeError(`not a hex colour: ${color}`);
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ];
}

/** WCAG 2.x relative luminance. */
export function relativeLuminance(color: string): number {
  const [r, g, b] = parseHex(color).map((value) => {
    const channel = value / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio, 1..21. Order-independent. */
export function contrastRatio(foreground: string, background: string): number {
  const a = relativeLuminance(foreground);
  const b = relativeLuminance(background);
  const [lighter, darker] = a >= b ? [a, b] : [b, a];
  return (lighter + 0.05) / (darker + 0.05);
}

/** AA needs 4.5 for normal text, 3.0 for large (>=18pt, or >=14pt bold). */
export const AA_NORMAL = 4.5;
export const AA_LARGE = 3;
