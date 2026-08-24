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
    '--radius': `${tokens.radius.md}px`,
    '--font': `"${tokens.fontBody}", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif`,
    '--font-display': `"${tokens.fontDisplay}", Georgia, "Iowan Old Style", serif`,
  };
}
