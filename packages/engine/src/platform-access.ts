import { createClient } from '@supabase/supabase-js';

import { fetchExternalWithRetry } from './http';

export type PlatformAccessEnvironment = {
  url: string;
  serviceRoleKey: string;
};

export type PlatformAccessEvent = {
  action: string;
  actorId: string;
  brandId: string;
  correlationId: string;
  locationId: string | null;
  metadata: Readonly<Record<string, string>>;
};

export type PlatformAccessWriteResult =
  | { ok: true }
  | { ok: false; errorCode: string; reason: 'invalid_event' | 'rpc_failed' | 'rpc_unavailable' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ACTION = /^[a-z][a-z0-9_.]{2,95}$/;
const MAX_METADATA_ENTRIES = 16;

function validMetadata(metadata: Readonly<Record<string, string>>): boolean {
  const entries = Object.entries(metadata);
  return entries.length <= MAX_METADATA_ENTRIES && entries.every(([key, value]) => (
    key.length > 0 && key.length <= 64 && value.length <= 256
  ));
}

function validEvent(event: PlatformAccessEvent): boolean {
  return ACTION.test(event.action)
    && UUID.test(event.actorId)
    && UUID.test(event.brandId)
    && UUID.test(event.correlationId)
    && (event.locationId === null || UUID.test(event.locationId))
    && validMetadata(event.metadata);
}

/**
 * The sole trusted writer for cross-tenant platform access. Transport retries
 * reuse the correlation id as both the HTTP key and database unique key, so a
 * lost response can never create a second audit event.
 */
export async function recordPlatformAccessEvent(
  environment: PlatformAccessEnvironment,
  event: PlatformAccessEvent,
): Promise<PlatformAccessWriteResult> {
  if (!validEvent(event)) {
    return { ok: false, errorCode: 'invalid_event', reason: 'invalid_event' };
  }
  try {
    const db = createClient(environment.url, environment.serviceRoleKey, {
      auth: { persistSession: false },
      global: {
        headers: { 'Idempotency-Key': event.correlationId },
        fetch: (input, init) => fetchExternalWithRetry(input, init),
      },
    });
    const { error } = await db.rpc('record_platform_access', {
      p_action: event.action,
      p_actor_id: event.actorId,
      p_brand_id: event.brandId,
      p_correlation_id: event.correlationId,
      p_location_id: event.locationId,
      p_metadata: event.metadata,
    });
    if (!error) return { ok: true };
    if (!error.code) {
      return { ok: false, errorCode: 'unavailable', reason: 'rpc_unavailable' };
    }
    return { ok: false, errorCode: error.code, reason: 'rpc_failed' };
  } catch {
    return { ok: false, errorCode: 'unavailable', reason: 'rpc_unavailable' };
  }
}
