import { liveScope } from './live-scope';
import {
  demoSquareConnectionStatuses,
  emptyLiveSquareConnectionStatuses,
  loadSquareConnectionStatusQuery,
  type SquareConnectionStatusLoad,
  type SquareStatusRow,
} from './square-connection-status-result';
import { serverClient } from './supabase-server';

/** Load staff-visible Square connections, including grants that need renewed consent. */
export async function loadSquareConnectionStatuses(): Promise<SquareConnectionStatusLoad> {
  const client = await serverClient();
  if (!client) return demoSquareConnectionStatuses();
  const scope = await liveScope(client);
  const orgId = scope.orgId;
  if (!orgId) return emptyLiveSquareConnectionStatuses();
  return loadSquareConnectionStatusQuery(() => client.from('location_square_status')
    .select('location_id, oauth_scope_contract_version')
    .eq('brand_id', orgId)
    .returns<SquareStatusRow[]>());
}
