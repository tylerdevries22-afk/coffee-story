'use client';

/**
 * The brand-config editor with a live preview: the same resolve rules
 * packages/ui applies on device (a bad hex falls back rather than
 * unbranding), rendered as a phone-shaped card beside the controls.
 */
import { useMemo, useState } from 'react';

type EditableTokens = {
  primary: string;
  surface: string;
  surfaceElevated: string;
  accent: string;
  textPrimary: string;
  textMuted: string;
};

/**
 * Only a last resort. The real starting point is `tenants/_template/brand.json`,
 * handed in by the page: this editor is where a platform admin configures ANY
 * brand, and it used to open pre-filled with Coffee Story's palette, its name,
 * its "Beans", and its feature flags. Setting up the second tenant therefore
 * began by inheriting the first one's identity, one Save away from storing it.
 */
const FALLBACK: EditableTokens = {
  primary: '#1C1917',
  surface: '#FAFAF9',
  surfaceElevated: '#FFFFFF',
  accent: '#8A7350',
  textPrimary: '#1C1917',
  textMuted: '#57534E',
};

const FLAGS = ['drops', 'catering', 'delivery', 'multi_location', 'sms', 'stored_value', 'referrals'] as const;

const HEX = /^#[0-9a-fA-F]{6}$/;

export type BrandConfigDefaults = {
  tokens?: Partial<Record<keyof EditableTokens, unknown>>;
  copy?: { appName?: unknown; pointsName?: unknown };
  features?: Record<string, unknown>;
};

function tokensFrom(defaults: BrandConfigDefaults | undefined): EditableTokens {
  const result = { ...FALLBACK };
  for (const key of Object.keys(FALLBACK) as (keyof EditableTokens)[]) {
    const value = defaults?.tokens?.[key];
    if (typeof value === 'string' && HEX.test(value)) result[key] = value;
  }
  return result;
}

function textFrom(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim().length > 0 ? value : fallback;
}

export function BrandConfigEditor({ defaults }: { defaults?: BrandConfigDefaults }) {
  const [tokens, setTokens] = useState<EditableTokens>(() => tokensFrom(defaults));
  const [appName, setAppName] = useState(() => textFrom(defaults?.copy?.appName, 'Your Brand'));
  const [pointsName, setPointsName] = useState(() => textFrom(defaults?.copy?.pointsName, 'Points'));
  const [flags, setFlags] = useState<Record<string, boolean>>(() => Object.fromEntries(
    FLAGS.map((flag) => [flag, Boolean(defaults?.features?.[flag])]),
  ));

  // The device-side rule: a malformed value falls back, field by field.
  const applied = useMemo(() => {
    const result = tokensFrom(defaults);
    for (const key of Object.keys(FALLBACK) as (keyof EditableTokens)[]) {
      if (HEX.test(tokens[key])) result[key] = tokens[key];
    }
    return result;
  }, [defaults, tokens]);

  return (
    <div className="grid-2">
      <div>
        <div className="card">
          <h2>Tokens</h2>
          {(Object.keys(FALLBACK) as (keyof EditableTokens)[]).map((key) => (
            <label className="field" key={key}>
              {key}
              <input
                value={tokens[key]}
                onChange={(event) => setTokens((current) => ({ ...current, [key]: event.target.value }))}
                aria-invalid={!HEX.test(tokens[key])}
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
          <h2>Feature flags</h2>
          {FLAGS.map((flag) => (
            <label className="field" key={flag} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <input
                type="checkbox"
                style={{ width: 'auto' }}
                checked={Boolean(flags[flag])}
                onChange={() => setFlags((current) => ({ ...current, [flag]: !current[flag] }))}
              />
              {flag}
            </label>
          ))}
        </div>
        <button className="button" type="button">Save to brand</button>
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
          <div style={{ background: applied.surfaceElevated, borderRadius: 16, padding: 16, marginBottom: 12 }}>
            <div style={{ fontWeight: 700 }}>This week&apos;s drop</div>
            <div style={{ color: applied.textMuted, fontSize: 13 }}>However this brand describes it, in its own words.</div>
            <div style={{
              display: 'inline-block', marginTop: 8, padding: '3px 10px', borderRadius: 999,
              background: `${applied.accent}26`, color: applied.textPrimary, fontSize: 12, fontWeight: 700,
            }}>
              ● Ends in 4h 12m
            </div>
          </div>
          {flags.drops ? null : (
            <div style={{ color: applied.textMuted, fontSize: 12, marginBottom: 8 }}>
              (drops off: the hero shows house favorites instead)
            </div>
          )}
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
