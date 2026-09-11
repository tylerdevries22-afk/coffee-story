import type { SupabaseClient } from '@supabase/supabase-js';

import type { OperationOccurrenceRow } from '@platform/schema';
import { abortRead, readWithRetry } from './read-retry';
import {
  OPERATION_COLUMNS, OperationDataError, operationRow, requireIdentifier, structuredError,
} from './operations-support';

export async function fetchOperationQueue(
  client: SupabaseClient,
  brandId: string,
  locationId: string,
  startsBefore: string,
): Promise<OperationOccurrenceRow[]> {
  requireIdentifier(brandId, 'Brand');
  requireIdentifier(locationId, 'Location');
  try {
    const rows = await readWithRetry('fetchOperationQueue', (signal) => abortRead(client
      .from('operation_occurrences')
      .select(OPERATION_COLUMNS)
      .eq('brand_id', brandId)
      .eq('location_id', locationId)
      .lte('scheduled_for', startsBefore)
      .in('status', ['scheduled', 'claimed'])
      .order('scheduled_for'), signal).returns<OperationOccurrenceRow[]>());
    return (rows ?? []).map(operationRow);
  } catch (error) {
    throw structuredError(error);
  }
}


export function subscribeToOperationQueue(
  client: SupabaseClient,
  locationId: string,
  onChange: () => void,
  onError?: (error: OperationDataError) => void,
): () => void {
  requireIdentifier(locationId, 'Location');
  const channel = client.channel(`operations-${locationId}`).on('postgres_changes', {
    event: '*', schema: 'public', table: 'operations_change_signals', filter: `location_id=eq.${locationId}`,
  }, () => onChange()).subscribe((status) => {
    if (status === 'SUBSCRIBED') onChange();
    if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
      onError?.(new OperationDataError('network', 'Live operations updates are reconnecting.', true));
    }
  });
  return () => { void client.removeChannel(channel); };
}
