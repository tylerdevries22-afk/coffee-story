import type { SupabaseClient } from '@supabase/supabase-js';

export type LocationSettings = {
  id: string;
  ordering_paused: boolean;
  hours: unknown;
};

/** Location settings change rarely, so a signal triggers one authoritative read. */
export function subscribeToLocationSettings(
  client: SupabaseClient | null,
  locationId: string,
  onChanged: () => void,
): () => void {
  if (!client) return () => {};
  const channel = client
    .channel(`location-settings-${locationId}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'location_setting_signals', filter: `location_id=eq.${locationId}` },
      onChanged,
    )
    .subscribe();
  return () => {
    void client.removeChannel(channel);
  };
}
