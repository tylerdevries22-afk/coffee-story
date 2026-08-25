/**
 * Compatibility exports for screens that still use module-scope styles.
 *
 * The values are no longer Coffee Story constants. Onboarding replaces the
 * bundled brand.json, and this resolver turns that tenant's seed palette and
 * optional ramp overrides into the shape those screens already consume.
 * Because a customer binary belongs to one tenant, resolving once at module
 * load is both reactive enough and safe for StyleSheet.create at module scope.
 */
import { resolveAppTokens } from '@platform/ui/app-tokens';

import { TENANT } from '@/tenant';

const appTokens = resolveAppTokens(TENANT.tokens);

export const colors = appTokens.colors;
export const radius = appTokens.radius;
export const spacing = appTokens.spacing;
export const scrim = appTokens.scrim;
export const motion = appTokens.motion;
export const shadow = appTokens.shadow;
export const fonts = appTokens.fonts;
