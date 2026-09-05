import { APP_COLOR_KEYS } from '@platform/ui/app-tokens';
import { isRegisteredFont } from '@platform/ui/font-registry';

import type { TenantManifest } from '../../packages/tenant-config/src/index.js';

const HEX = /^#[0-9a-fA-F]{6}$/;
const BASE_COLORS = [
  'primary', 'secondary', 'surface', 'surfaceElevated', 'accent',
  'textPrimary', 'textMuted', 'success', 'warning', 'danger',
] as const;

export function validateTokens(tokens: TenantManifest['tokens'], problems: string[]): void {
  for (const key of BASE_COLORS) {
    if (!HEX.test(String(tokens[key] ?? ''))) problems.push(`tokens.${key} must be #RRGGBB.`);
  }
  for (const key of ['fontDisplay', 'fontBody'] as const) {
    const family = tokens[key];
    if (typeof family !== 'string' || !isRegisteredFont(family)) {
      problems.push(`tokens.${key} must be a bundled family: System, Inter, or Fraunces.`);
    }
  }
  const knownRampKeys = new Set<string>(APP_COLOR_KEYS);
  for (const [key, value] of Object.entries(tokens.ramp ?? {})) {
    if (key.startsWith('$')) continue;
    if (!knownRampKeys.has(key)) problems.push(`tokens.ramp.${key} is unsupported.`);
    else if (!HEX.test(value)) problems.push(`tokens.ramp.${key} must be #RRGGBB.`);
  }
}
