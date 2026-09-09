import type { StatusTone } from './order-status-pill-logic';
import type { BrandTokens } from './tokens';

export function toneColor(tokens: BrandTokens, tone: StatusTone): string {
  switch (tone) {
    case 'success': return tokens.success;
    case 'warning': return tokens.warning;
    case 'danger': return tokens.danger;
    default: return tokens.textMuted;
  }
}

/** With-opacity variant of a #RRGGBB token, for tints and backdrops. */
export function withAlpha(hex: string, alpha: number): string {
  const clamped = Math.round(Math.min(1, Math.max(0, alpha)) * 255);
  return `${hex}${clamped.toString(16).padStart(2, '0').toUpperCase()}`;
}
