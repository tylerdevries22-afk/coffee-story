/** Short-TTL ACTZ ↔ App Factory handoff JWTs (aud=app-factory). Never reuse Elevate secrets. */
import { createHmac, timingSafeEqual } from 'node:crypto';

export const ACTZ_HANDOFF_TTL_SECONDS = 5 * 60;
export const ACTZ_HANDOFF_AUD = 'app-factory';
export const ACTZ_HANDOFF_ISS = 'actz-partner';

export type ActzHandoffClaims = {
  readonly actzProviderOrgId: string;
  readonly brandId?: string;
  readonly intent?: 'open_dashboard' | 'start_wizard';
  readonly returnUrl?: string;
};

export type ActzHandoffFailure =
  | 'malformed'
  | 'bad_signature'
  | 'expired'
  | 'bad_audience'
  | 'bad_issuer';

const b64url = (value: object): string =>
  Buffer.from(JSON.stringify(value)).toString('base64url');

function sign(data: string, secret: string): string {
  return createHmac('sha256', secret).update(data).digest('base64url');
}

/** http(s) only — no credentials, no javascript:. */
export function sanitizePartnerUrl(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function mintActzHandoffToken(
  secret: string,
  claims: ActzHandoffClaims,
  nowMs: number,
  ttlSeconds: number = ACTZ_HANDOFF_TTL_SECONDS,
): string {
  const iat = Math.floor(nowMs / 1000);
  const header = b64url({ alg: 'HS256', typ: 'JWT' });
  const payload = b64url({
    iss: ACTZ_HANDOFF_ISS,
    aud: ACTZ_HANDOFF_AUD,
    iat,
    exp: iat + ttlSeconds,
    actz_provider_org_id: claims.actzProviderOrgId,
    ...(claims.brandId ? { brand_id: claims.brandId } : {}),
    ...(claims.intent ? { intent: claims.intent } : {}),
    ...(sanitizePartnerUrl(claims.returnUrl) ? { return_url: sanitizePartnerUrl(claims.returnUrl) } : {}),
  });
  const signature = sign(`${header}.${payload}`, secret);
  return `${header}.${payload}.${signature}`;
}

export function verifyActzHandoffToken(
  secret: string,
  token: string,
  nowMs: number,
): { ok: true; claims: ActzHandoffClaims } | { ok: false; reason: ActzHandoffFailure } {
  const parts = token.split('.');
  if (parts.length !== 3) return { ok: false, reason: 'malformed' };
  const [header, payload, signature] = parts as [string, string, string];
  const expected = sign(`${header}.${payload}`, secret);
  const given = Buffer.from(signature);
  const want = Buffer.from(expected);
  if (given.length !== want.length || !timingSafeEqual(given, want)) {
    return { ok: false, reason: 'bad_signature' };
  }
  let decoded: Record<string, unknown>;
  let head: Record<string, unknown>;
  try {
    decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<string, unknown>;
    head = JSON.parse(Buffer.from(header, 'base64url').toString('utf8')) as Record<string, unknown>;
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  if (head.alg !== 'HS256') return { ok: false, reason: 'malformed' };
  if (decoded.aud !== ACTZ_HANDOFF_AUD) return { ok: false, reason: 'bad_audience' };
  if (decoded.iss !== ACTZ_HANDOFF_ISS) return { ok: false, reason: 'bad_issuer' };
  if (typeof decoded.exp !== 'number' || decoded.exp <= Math.floor(nowMs / 1000)) {
    return { ok: false, reason: 'expired' };
  }
  const actzProviderOrgId = decoded.actz_provider_org_id;
  if (typeof actzProviderOrgId !== 'string' || !actzProviderOrgId.trim()) {
    return { ok: false, reason: 'malformed' };
  }
  const brandId = typeof decoded.brand_id === 'string' && decoded.brand_id ? decoded.brand_id : undefined;
  const intent =
    decoded.intent === 'open_dashboard' || decoded.intent === 'start_wizard'
      ? decoded.intent
      : undefined;
  const returnUrl = sanitizePartnerUrl(
    typeof decoded.return_url === 'string' ? decoded.return_url : null,
  ) ?? undefined;
  return {
    ok: true,
    claims: {
      actzProviderOrgId: actzProviderOrgId.trim(),
      ...(brandId ? { brandId } : {}),
      ...(intent ? { intent } : {}),
      ...(returnUrl ? { returnUrl } : {}),
    },
  };
}
