'use client';

import { isBrandHex, type EditableTier } from '@/lib/brand-config';

/**
 * The badge exactly as apps/display draws it.
 *
 * Same wash, same border weight, same mark-in-front order — deliberately a
 * duplicate of the CSS rather than an import, because that stylesheet is a
 * wall screen's and this is a desk console's, and coupling them would mean a
 * board tweak silently restyling the admin. What must not drift is the
 * *rule* (26% wash, 42% border, ink type, mark leads), and that is stated in
 * both places and checked by apps/display's own tests.
 *
 * `surface` and `ink` are required rather than defaulted. They used to fall
 * back to `#FFFFFF` and `#241710`, and the editor's own swatch list omitted
 * them -- so the column an owner actually picks their colours in previewed the
 * wash against a generic white no tenant had configured. Requiring them means
 * a new call site has to name the surface the badge is drawn on, which is the
 * only way the 26% wash can be right.
 */
export function TierBadgePreview({
  tier,
  surface,
  ink,
}: {
  tier: EditableTier;
  surface: string;
  ink: string;
}) {
  const color = isBrandHex(tier.color) ? tier.color : '#57534E';
  return (
    <span
      className="tier-badge"
      style={{
        background: `color-mix(in srgb, ${color} 26%, ${surface})`,
        borderColor: `color-mix(in srgb, ${color} 42%, transparent)`,
        color: ink,
      }}
    >
      <i aria-hidden="true" style={{ color: `color-mix(in srgb, ${color} 78%, ${ink})` }}>
        {tier.icon || '✦'}
      </i>
      {tier.label}
    </span>
  );
}
