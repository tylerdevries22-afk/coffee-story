import { deliverOperationPushBatch, liveTransport, type OperationPushResult, type OperationPushWork } from '@platform/engine';
import type { SupabaseClient } from '@supabase/supabase-js';

type OperationOutboxRow = {
  id: string; brand_id: string; location_id: string; occurrence_id: string;
  recipient_id: string; channel: string; attempt_count: number;
};
type OperationContextRow = { id: string; template_snapshot: unknown };

function snapshotTitle(value: unknown): string {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 'Scheduled operation';
  const title = (value as Record<string, unknown>).title;
  return typeof title === 'string' && title.trim() ? title : 'Scheduled operation';
}

function recipientKey(brandId: string, recipientId: string): string {
  return `${brandId}:${recipientId}`;
}

async function operationPushWork(
  db: SupabaseClient,
  rows: readonly OperationOutboxRow[],
): Promise<OperationPushWork[]> {
  const [occurrences, locations, brands, devices] = await Promise.all([
    db.from('operation_occurrences').select('id,template_snapshot')
      .in('id', rows.map((row) => row.occurrence_id)).returns<OperationContextRow[]>(),
    db.from('locations').select('id,name').in('id', rows.map((row) => row.location_id))
      .returns<{ id: string; name: string }[]>(),
    db.from('brands').select('id,name').in('id', rows.map((row) => row.brand_id))
      .returns<{ id: string; name: string }[]>(),
    db.from('operation_staff_devices').select('brand_id,brand_user_id,expo_push_token')
      .eq('is_active', true).in('brand_user_id', rows.map((row) => row.recipient_id))
      .returns<{ brand_id: string; brand_user_id: string; expo_push_token: string }[]>(),
  ]);
  const failedRead = [occurrences, locations, brands, devices].find((result) => result.error)?.error;
  if (failedRead) throw failedRead;
  const occurrenceMap = new Map((occurrences.data ?? []).map((row) => [row.id, row]));
  const locationMap = new Map((locations.data ?? []).map((row) => [row.id, row.name]));
  const brandMap = new Map((brands.data ?? []).map((row) => [row.id, row.name]));
  const tokenMap = new Map<string, Set<string>>();
  for (const device of devices.data ?? []) {
    const key = recipientKey(device.brand_id, device.brand_user_id);
    const tokens = tokenMap.get(key) ?? new Set<string>();
    tokens.add(device.expo_push_token);
    tokenMap.set(key, tokens);
  }
  return rows.map((row) => ({
    outboxId: row.id,
    occurrenceId: row.occurrence_id,
    tokens: [...(tokenMap.get(recipientKey(row.brand_id, row.recipient_id)) ?? [])],
    appName: brandMap.get(row.brand_id) ?? 'Operations',
    taskTitle: snapshotTitle(occurrenceMap.get(row.occurrence_id)?.template_snapshot),
    locationName: locationMap.get(row.location_id) ?? 'your location',
  }));
}

export async function persistOperationPushResults(
  db: SupabaseClient,
  rows: readonly OperationOutboxRow[],
  results: readonly OperationPushResult[],
  now: Date,
): Promise<void> {
  const outboxMap = new Map(rows.map((row) => [row.id, row]));
  await Promise.all(results.map(async (result) => {
    const row = outboxMap.get(result.outboxId);
    if (!row) throw new Error('Claimed operation notification context was lost.');
    const retrySeconds = Math.min(3_600, 30 * (2 ** Math.min(row.attempt_count, 7)));
    const values = result.outcome === 'sent'
      ? { status: 'sent', sent_at: now.toISOString(), last_error: null }
      : result.outcome === 'uncertain'
        ? { status: 'cancelled', last_error: result.errorCode }
        : { status: 'failed', available_at: new Date(now.getTime() + retrySeconds * 1_000).toISOString(),
        last_error: result.errorCode };
    const updated = await db.from('operation_notification_outbox').update(values)
      .eq('id', result.outboxId).eq('status', 'sending')
      .eq('attempt_count', row.attempt_count);
    if (updated.error) throw updated.error;
  }));
}

export async function deliverOperationNotifications(db: SupabaseClient, now: Date): Promise<{
  sent: number; failed: number; uncertain: number;
}> {
  const claimed = await db.rpc('claim_operation_notification_batch', { target_limit: 50 });
  if (claimed.error) throw claimed.error;
  const claimedRows = Array.isArray(claimed.data) ? claimed.data as OperationOutboxRow[] : [];
  const rows = claimedRows.filter((row) => row.channel === 'push');
  if (rows.length === 0) return { sent: 0, failed: 0, uncertain: 0 };
  const results = await deliverOperationPushBatch(liveTransport(), await operationPushWork(db, rows));
  await persistOperationPushResults(db, rows, results, now);
  return {
    sent: results.filter((result) => result.outcome === 'sent').length,
    failed: results.filter((result) => result.outcome === 'failed').length,
    uncertain: results.filter((result) => result.outcome === 'uncertain').length,
  };
}

