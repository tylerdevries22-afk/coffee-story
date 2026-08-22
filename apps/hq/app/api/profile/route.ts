import type { UpdateProfileRequest } from '@platform/api-client';

import {
  corsPreflight,
  jsonWithCors,
  authenticate,
  jsonError,
  notConfigured,
  parseJsonBody,
  resolveCustomer,
  serverEnv,
  serviceDb,
} from '../../../lib/api-auth';

/**
 * POST /api/profile — the guest's own contact card. Only the fields sent
 * change; user_id never moves (the identity-protection trigger backs this up
 * at the database). Phone is stored as given — E.164 normalisation arrives
 * with SMS (Twilio) support.
 */

const MAX_NAME_LENGTH = 200;
const MAX_EMAIL_LENGTH = 320;
const MAX_PHONE_LENGTH = 32;

export async function POST(request: Request): Promise<Response> {
  const env = serverEnv();
  if (!env) return notConfigured();
  const db = serviceDb(env);

  const auth = await authenticate(request, db);
  if (auth instanceof Response) return auth;

  const body = await parseJsonBody<UpdateProfileRequest>(request);
  if (body instanceof Response) return body;

  const patch: Record<string, unknown> = {};
  if (body.fullName !== undefined) {
    if (typeof body.fullName !== 'string' || body.fullName.length > MAX_NAME_LENGTH) {
      return jsonError(400, 'invalid_request', 'fullName must be a short string.');
    }
    patch.full_name = body.fullName;
  }
  if (body.email !== undefined) {
    if (body.email !== null && (typeof body.email !== 'string' || body.email.length > MAX_EMAIL_LENGTH || !body.email.includes('@'))) {
      return jsonError(400, 'invalid_request', 'email must be an address or null.');
    }
    patch.email = body.email;
  }
  if (body.phone !== undefined) {
    if (body.phone !== null && (typeof body.phone !== 'string' || body.phone.length > MAX_PHONE_LENGTH)) {
      return jsonError(400, 'invalid_request', 'phone must be a short string or null.');
    }
    patch.phone = body.phone;
  }
  if (body.smsOptIn !== undefined) {
    if (typeof body.smsOptIn !== 'boolean') {
      return jsonError(400, 'invalid_request', 'smsOptIn must be a boolean.');
    }
    patch.sms_opt_in = body.smsOptIn;
  }
  if (Object.keys(patch).length === 0) {
    return jsonError(400, 'invalid_request', 'Send at least one profile field.');
  }

  const customer = await resolveCustomer(db, auth);
  const updated = await db.from('customers').update(patch).eq('id', customer.id);
  if (updated.error) {
    // UNIQUE (brand_id, phone): the number already belongs to another guest.
    if (updated.error.code === '23505') {
      return jsonError(409, 'phone_in_use', 'That phone number is already on another account.');
    }
    throw updated.error;
  }

  return jsonWithCors({ ok: true });
}

/** Browser preflight for the customer web build. */
export function OPTIONS(): Response {
  return corsPreflight();
}
