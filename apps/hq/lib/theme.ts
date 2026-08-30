import { resolveTokens } from '@platform/ui/tokens';

/** CSS variables for the console's dark, tenant-aware expression of the shared token contract. */
export function hqTheme(brandConfig: unknown): Record<string, string> {
  const source = typeof brandConfig === 'object' && brandConfig !== null
    ? brandConfig as Record<string, unknown>
    : {};
  const tokens = resolveTokens(source.tokens);
  return {
    '--bg': tokens.primary,
    '--bg-raised': tokens.secondary,
    '--bg-hover': `color-mix(in srgb, ${tokens.primary} 76%, ${tokens.secondary})`,
    '--line': `color-mix(in srgb, ${tokens.surface} 18%, ${tokens.primary})`,
    '--text': tokens.surfaceElevated,
    '--text-muted': `color-mix(in srgb, ${tokens.surface} 62%, ${tokens.primary})`,
    '--accent': tokens.accent,
    '--success': tokens.success,
    '--warning': tokens.warning,
    '--danger': tokens.danger,
    // The kiosk preview draws the tenant's warm surface inside the dark
    // console, so it needs the same tokens read the other way up: ink on
    // surface, not surface on ink. Same brand, the app's expression of it
    // (docs/DESIGN.md). These had been Coffee Story's literal hexes in
    // globals.css, which meant every tenant previewed somebody else's shop.
    '--kiosk-surface': tokens.surface,
    '--kiosk-ink': tokens.textPrimary,
    '--kiosk-ink-muted': tokens.textMuted,
    '--kiosk-hero': tokens.primary,
    '--kiosk-line': `color-mix(in srgb, ${tokens.accent} 28%, ${tokens.surface})`,
    '--kiosk-line-strong': `color-mix(in srgb, ${tokens.textMuted} 74%, ${tokens.surface})`,
    '--radius': `${tokens.radius.md}px`,
    '--space-xs': `${tokens.spacing.xs}px`,
    '--space-sm': `${tokens.spacing.sm}px`,
    '--space-md': `${tokens.spacing.md}px`,
    '--space-lg': `${tokens.spacing.lg}px`,
    '--space-xl': `${tokens.spacing.xl}px`,
    '--space-xxl': `${tokens.spacing.xxl}px`,
    '--font': `"${tokens.fontBody}", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif`,
    '--font-display': `"${tokens.fontDisplay}", Georgia, "Iowan Old Style", serif`,
  };
}
