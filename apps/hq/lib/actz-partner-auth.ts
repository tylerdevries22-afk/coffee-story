/** ACTZ partner edge auth: shared secret (required). Optional handoff JWT. Fail closed. */
import { jsonError, matchesSecret, serverEnv, serviceDb } from './api-auth';
import {
  verifyActzHandoffToken,
  type ActzHandoffClaims,
} from './actz-handoff';
import type { SupabaseClient } from '@supabase/supabase-js';

export const ACTZ_INTEGRATION_KEY_HEADER = 'x-integration-key';

export type ActzPartnerAuth =
  | { ok: true; db: SupabaseClient; handoff: ActzHandoffClaims | null }
  | { ok: false; response: Response };

export function actzIntegrationSecret(): string | null {
  const value = process.env.ACTZ_INTEGRATION_SECRET?.trim();
  return value || null;
}

export function appFactoryHandoffSecret(): string | null {
  const value = process.env.APP_FACTORY_HANDOFF_SECRET?.trim();
  return value || null;
}

export function actzIntegrationKeyAccepted(request: Request): boolean {
  const expected = actzIntegrationSecret();
  if (!expected) return false;
  return matchesSecret(request.headers.get(ACTZ_INTEGRATION_KEY_HEADER), expected);
}

function bearerToken(request: Request): string | null {
  const header = request.headers.get('authorization') ?? '';
  if (!header.startsWith('Bearer ')) return null;
  const token = header.slice('Bearer '.length).trim();
  return token || null;
}

/**
 * Verifies ACTZ_INTEGRATION_SECRET, then optional handoff JWT.
 * Missing secret env → 501. Wrong key → 401. Bad optional bearer → 401.
 */
export function authenticateActzPartner(request: Request, nowMs = Date.now()): ActzPartnerAuth {
  const env = serverEnv();
  if (!env) {
    return { ok: false, response: jsonError(501, 'not_configured', 'This deployment has no Supabase configuration.') };
  }
  if (!actzIntegrationSecret()) {
    return {
      ok: false,
      response: jsonError(501, 'not_configured', 'ACTZ partner integration is not configured.'),
    };
  }
  if (!actzIntegrationKeyAccepted(request)) {
    return {
      ok: false,
      response: jsonError(401, 'unauthorized', 'This integration is not configured for that key.'),
    };
  }
  const token = bearerToken(request);
  let handoff: ActzHandoffClaims | null = null;
  if (token) {
    const handoffSecret = appFactoryHandoffSecret();
    if (!handoffSecret) {
      return {
        ok: false,
        response: jsonError(501, 'not_configured', 'App Factory handoff is not configured.'),
      };
    }
    const verified = verifyActzHandoffToken(handoffSecret, token, nowMs);
    if (!verified.ok) {
      return {
        ok: false,
        response: jsonError(401, 'unauthorized', `Handoff token rejected (${verified.reason}).`),
      };
    }
    handoff = verified.claims;
  }
  return { ok: true, db: serviceDb(env), handoff };
}
