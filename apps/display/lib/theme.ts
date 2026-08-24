import { resolveTokens, type BrandTokens } from '@platform/ui/tokens';

/**
 * The tenant's palette, as CSS custom properties.
 *
 * This file exists because `display.css` used to open with a block of literal
 * hex values -- `--surface: #faf5ef`, `--brass: #b08d57` -- lifted from
 * Coffee Story's brand.json. That is rule 4 exactly ("no component hard-codes
 * a color"), and it meant the second tenant to hang a screen would have got
 * the first tenant's brand on their wall. The stylesheet now declares only
 * relationships; every value arrives here, hydrated per brand.
 *
 * Server-rendered into a `style` attribute rather than a `<style>` block so a
 * screen that reboots at 5am paints the right colours on the first frame,
 * with no flash of the fallback palette for the room to watch.
 */
export type DisplayTheme = {
  tokens: BrandTokens;
  cssVariables: Record<string, string>;
};

/**
 * Semantic names, not token names.
 *
 * The stylesheet says `--board-ink`, so a token rename never becomes a CSS
 * rename, and a value can be derived (the hairline below is `line`, mixed,
 * not a token anyone authors) without the stylesheet knowing.
 */
export function displayTheme(brandConfig: unknown): DisplayTheme {
  const config = (typeof brandConfig === 'object' && brandConfig !== null)
    ? (brandConfig as Record<string, unknown>)
    : {};
  const tokens = resolveTokens(config.tokens);
  return {
    tokens,
    cssVariables: {
      '--board-surface': tokens.surface,
      '--board-raised': tokens.surfaceElevated,
      '--board-ink': tokens.textPrimary,
      '--board-ink-muted': tokens.textMuted,
      '--board-accent': tokens.accent,
      '--board-primary': tokens.primary,
      '--board-success': tokens.success,
      '--board-warning': tokens.warning,
      // A hairline is the ground and the ink at low weight. Deriving it beats
      // asking every tenant to pick a border colour they will never look at.
      '--board-line': `color-mix(in srgb, ${tokens.textMuted} 22%, ${tokens.surface})`,
      '--board-radius': `${tokens.radius.lg}px`,
      '--board-radius-pill': `${tokens.radius.pill}px`,
      '--board-gap': `${tokens.spacing.md}px`,
      '--board-motion': `${tokens.motion.base}ms`,
      // The type pairing, with a stack behind it: a wall screen has no time to
      // wait for a webfont, and the tenant's display face is a nice-to-have
      // on a surface whose job is a number readable at fifteen feet.
      '--board-font-display': `"${tokens.fontDisplay}", Georgia, "Iowan Old Style", "Times New Roman", serif`,
      '--board-font-body': `"${tokens.fontBody}", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`,
    },
  };
}

/** The tone a tier badge is tinted with, resolved to the variable the CSS reads. */
export const TIER_TONE_VARIABLE: Readonly<Record<string, string>> = {
  muted: 'var(--board-ink-muted)',
  accent: 'var(--board-accent)',
  success: 'var(--board-success)',
  primary: 'var(--board-primary)',
};
