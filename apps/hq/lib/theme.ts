import { resolveTokens } from '@platform/ui/tokens';

/** CSS variables for the console's light, tenant-aware expression of the shared token contract. */
export function hqTheme(brandConfig: unknown): Record<string, string> {
  const source = typeof brandConfig === 'object' && brandConfig !== null
    ? brandConfig as Record<string, unknown>
    : {};
  const tokens = resolveTokens(source.tokens);
  return {
    '--bg': tokens.surface,
    '--bg-raised': tokens.surfaceElevated,
    '--bg-hover': `color-mix(in srgb, ${tokens.primary} 5%, ${tokens.surface})`,
    '--line': `color-mix(in srgb, ${tokens.primary} 12%, ${tokens.surface})`,
    '--text': tokens.textPrimary,
    '--text-muted': tokens.textMuted,
    '--accent': tokens.accent,
    '--action': tokens.primary,
    '--action-foreground': tokens.surfaceElevated,
    '--success': tokens.success,
    '--warning': tokens.warning,
    '--danger': tokens.danger,
    '--hq-canvas': `color-mix(in srgb, ${tokens.surface} 78%, ${tokens.surfaceElevated})`,
    '--hq-rail': tokens.textPrimary,
    '--hq-rail-foreground': tokens.surfaceElevated,
    '--hq-rail-muted': `color-mix(in srgb, ${tokens.surfaceElevated} 64%, ${tokens.textPrimary})`,
    '--hq-rail-active': `color-mix(in srgb, ${tokens.surfaceElevated} 12%, ${tokens.textPrimary})`,
    // The generated shadcn/ReUI primitives deliberately consume the same
    // tenant variables as the pre-existing console. Mapping their semantic
    // roles here keeps generated components white-label instead of locking
    // them to a neutral preset.
    '--background': tokens.surface,
    '--foreground': tokens.textPrimary,
    '--card': tokens.surfaceElevated,
    '--card-foreground': tokens.textPrimary,
    '--popover': tokens.surfaceElevated,
    '--popover-foreground': tokens.textPrimary,
    '--primary': tokens.primary,
    '--primary-foreground': tokens.surfaceElevated,
    '--secondary': `color-mix(in srgb, ${tokens.primary} 5%, ${tokens.surface})`,
    '--secondary-foreground': tokens.textPrimary,
    '--muted': `color-mix(in srgb, ${tokens.primary} 4%, ${tokens.surface})`,
    '--muted-foreground': tokens.textMuted,
    '--accent-foreground': tokens.textPrimary,
    '--destructive': tokens.danger,
    '--destructive-foreground': tokens.surfaceElevated,
    '--border': `color-mix(in srgb, ${tokens.primary} 12%, ${tokens.surface})`,
    '--input': `color-mix(in srgb, ${tokens.primary} 16%, ${tokens.surface})`,
    '--ring': tokens.primary,
    '--info': tokens.accent,
    '--info-foreground': tokens.textPrimary,
    '--success-foreground': tokens.textPrimary,
    '--warning-foreground': tokens.textPrimary,
    // The kiosk preview has an independent display surface, so it needs the
    // same tenant tokens expressed as kiosk ink on kiosk surface: same brand,
    // different product expression (docs/DESIGN.md). These had been Coffee
    // Story's literal hexes in
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
    '--font-sans': `"${tokens.fontBody}", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif`,
    '--font-display': `"${tokens.fontDisplay}", Georgia, "Iowan Old Style", serif`,
  };
}
