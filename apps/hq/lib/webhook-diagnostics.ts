import type { SupabaseClient } from '@supabase/supabase-js';

type FailureContext = { eventId: string; orderId: string; brandId: string; stage: 'refund' | 'platform_fee' };

function safeCode(error: unknown): string {
  if (error && typeof error === 'object' && 'code' in error
    && typeof error.code === 'string' && /^[A-Z0-9_]{1,32}$/.test(error.code)) return error.code;
  return 'processing_failed';
}

/** Keep provider/database messages out of diagnostics while retaining a recovery key. */
export async function recordWebhookFailure(
  db: SupabaseClient, context: FailureContext, error: unknown,
): Promise<void> {
  const code = safeCode(error);
  let diagnosticStored = false;
  try {
    const result = await db.from('webhook_events')
      .update({ error: JSON.stringify({ stage: context.stage, code }) })
      .eq('event_id', context.eventId).select('event_id').maybeSingle();
    diagnosticStored = !result.error && Boolean(result.data);
  } catch {
    // Logging remains available when the same database outage prevents the receipt update.
  }
  const identifier = (value: string) => /^[a-zA-Z0-9_-]{1,128}$/.test(value) ? value : 'invalid_identifier';
  console.error('Square webhook processing failed.', {
    level: 'error', provider: 'square', stage: context.stage, code, diagnosticStored,
    eventId: identifier(context.eventId), orderId: identifier(context.orderId), brandId: identifier(context.brandId),
  });
}
