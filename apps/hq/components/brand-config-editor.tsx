'use client';

/**
 * The brand-config editor with a live preview: the same resolve rules
 * packages/ui applies on device (a bad hex falls back rather than
 * unbranding), rendered as a phone-shaped card beside the controls.
 */
import { useMemo, useState } from 'react';

import { saveBrandConfig } from '@/app/(console)/brand/actions';
import {
  EDITABLE_TOKEN_KEYS,
  brandEditorStateOf,
  isBrandHex,
  type EditableTier,
} from '@/lib/brand-config';
import { TierBadgePreview } from '@/components/tier-badge-preview';

/**
 * The status ladder, as the in-store order board draws it.
 *
 * Colour and mark are per rung rather than one accent for all four, because
 * four steps of one colour do not read as four steps across a room -- which is
 * the only place these are ever seen. Both are optional in `brand_config`;
 * what this editor writes is what `resolveBoardConfig` reads, and a rung left
 * blank falls back to its semantic token and the brand's reward mark.
 */
export function BrandConfigEditor({
  initialConfig,
  updatedAt: initialUpdatedAt,
}: {
  initialConfig: unknown;
  updatedAt: string | null;
}) {
  const initialState = useMemo(() => brandEditorStateOf(initialConfig), [initialConfig]);
  const [tokens, setTokens] = useState(initialState.tokens);
  const [appName, setAppName] = useState(initialState.appName);
  const [pointsName, setPointsName] = useState(initialState.pointsName);
  const [tiers, setTiers] = useState<EditableTier[]>(initialState.tiers);
  const [updatedAt, setUpdatedAt] = useState(initialUpdatedAt);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const editTier = (index: number, patch: Partial<EditableTier>) =>
    setTiers((current) => current.map((tier, i) => (i === index ? { ...tier, ...patch } : tier)));

  // The device-side rule: a malformed value falls back, field by field.
  const applied = useMemo(() => {
    return brandEditorStateOf({ tokens }).tokens;
  }, [tokens]);

  async function save() {
    if (pending) return;
    setPending(true);
    setMessage(null);
    try {
      const result = await saveBrandConfig({
        tokens,
        copy: { appName, pointsName },
        board: { tiers },
      }, updatedAt);
      setMessage(result.ok ? 'Saved. Apps receive these settings on their next config read.' : result.error);
      if (result.ok) setUpdatedAt(result.updatedAt);
    } catch {
      setMessage('The settings could not be saved. Try again.');
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="grid-2">
      <div>
        <div className="card">
          <h2>Tokens</h2>
          {EDITABLE_TOKEN_KEYS.map((key) => (
            <label className="field" key={key}>
              {key}
              <input
                value={tokens[key]}
                onChange={(event) => setTokens((current) => ({ ...current, [key]: event.target.value }))}
                aria-invalid={!isBrandHex(tokens[key])}
              />
            </label>
          ))}
        </div>
        <div className="card">
          <h2>Copy</h2>
          <label className="field">App name<input value={appName} onChange={(event) => setAppName(event.target.value)} /></label>
          <label className="field">Points name<input value={pointsName} onChange={(event) => setPointsName(event.target.value)} /></label>
        </div>
        <div className="card">
          <h2>Status badges</h2>
          <p className="subtitle">
            What the in-store order board draws beside a guest&apos;s name. The mark
            leads the label; a blank colour falls back to the tier&apos;s token.
          </p>
          {tiers.map((tier, index) => (
            <div key={tier.slug} className="tier-row">
              <TierBadgePreview tier={tier} />
              <label className="field tier-field">
                Colour
                <input
                  value={tier.color}
                  aria-label={`${tier.label} badge colour`}
                  aria-invalid={!isBrandHex(tier.color)}
                  onChange={(event) => editTier(index, { color: event.target.value })}
                />
              </label>
              <label className="field tier-field tier-field-icon">
                Mark
                <input
                  value={tier.icon}
                  aria-label={`${tier.label} badge mark`}
                  maxLength={4}
                  onChange={(event) => editTier(index, { icon: event.target.value })}
                />
              </label>
            </div>
          ))}
        </div>

        <button className="button" type="button" disabled={pending} onClick={() => void save()}>
          {pending ? 'Saving…' : 'Save to brand'}
        </button>
        {message ? <p role="status" className="subtitle">{message}</p> : null}
      </div>

      <div className="card" style={{ position: 'sticky', top: 24 }}>
        <h2>Live preview</h2>
        <div
          style={{
            borderRadius: 32,
            border: '1px solid var(--line)',
            background: applied.surface,
            color: applied.textPrimary,
            padding: 24,
            maxWidth: 340,
            margin: '0 auto',
            fontFamily: 'Georgia, serif',
          }}
        >
          <div style={{ fontSize: 22, fontWeight: 700 }}>{appName || 'Your Brand'}</div>
          <div style={{ color: applied.textMuted, fontSize: 13, marginBottom: 16 }}>
            Earn {pointsName || 'Points'} on every order
          </div>
          <div style={{
            background: applied.surfaceElevated, borderRadius: 16, padding: 16, marginBottom: 12,
            display: 'flex', alignItems: 'center', gap: 12, fontFamily: 'var(--font)',
          }}>
            <span style={{ fontSize: 20, color: applied.textMuted, fontVariant: 'tabular-nums' }}>1</span>
            <span style={{ fontWeight: 700, flex: 1 }}>Sara D.</span>
            <TierBadgePreview tier={tiers[1] ?? initialState.tiers[0]!} surface={applied.surfaceElevated} ink={applied.textPrimary} />
          </div>
          <div style={{ background: applied.surfaceElevated, borderRadius: 16, padding: 16, marginBottom: 12 }}>
            <div style={{ fontWeight: 700 }}>Honey Lavender Latte</div>
            <div style={{ color: applied.textMuted, fontSize: 13 }}>Floral, golden, back for one week.</div>
            <div style={{
              display: 'inline-block', marginTop: 8, padding: '3px 10px', borderRadius: 999,
              background: `${applied.accent}26`, color: applied.textPrimary, fontSize: 12, fontWeight: 700,
            }}>
              ● Ends in 4h 12m
            </div>
          </div>
          <div style={{
            background: applied.primary, color: applied.surfaceElevated, borderRadius: 999,
            padding: '14px 20px', textAlign: 'center', fontWeight: 700, fontFamily: 'var(--font)',
          }}>
            Start an order
          </div>
        </div>
      </div>
    </div>
  );
}
