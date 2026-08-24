import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Payload-free pickup-board invalidation.
 *
 * A display may read `board_tickets`, but never `orders`: the latter carries
 * customer ids, totals, notes, and cart snapshots. The signal contains only a
 * location id and revision; callers reconcile through the safe view.
 */
export function subscribeToBoardChanges(
  client: SupabaseClient | null,
  locationId: string,
  onChanged: () => void,
): () => void {
  if (!client) return () => {};
  const channel = client
    .channel(`board-signal-${locationId}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'board_change_signals', filter: `location_id=eq.${locationId}` },
      onChanged,
    )
    .subscribe();
  return () => {
    void client.removeChannel(channel);
  };
}
