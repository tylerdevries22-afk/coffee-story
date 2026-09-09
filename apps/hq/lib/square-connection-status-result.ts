import {
  squareConnectionStatus,
  type SquareConnectionUiStatus,
} from './square-oauth-contract';

export type SquareStatusRow = {
  readonly location_id: string;
  readonly oauth_scope_contract_version: number;
};

export type SquareConnectionStatusLoad = {
  readonly source: 'demo' | 'live' | 'unavailable';
  readonly statuses: ReadonlyMap<string, SquareConnectionUiStatus>;
};

const emptyStatuses = (): ReadonlyMap<string, SquareConnectionUiStatus> => new Map();

export function demoSquareConnectionStatuses(): SquareConnectionStatusLoad {
  return { source: 'demo', statuses: emptyStatuses() };
}

export function emptyLiveSquareConnectionStatuses(): SquareConnectionStatusLoad {
  return { source: 'live', statuses: emptyStatuses() };
}

/** Convert a live query into status data without ever treating failure as consent. */
export async function loadSquareConnectionStatusQuery(
  query: () => PromiseLike<{ data: readonly SquareStatusRow[] | null; error: unknown }>,
): Promise<SquareConnectionStatusLoad> {
  try {
    const result = await query();
    if (result.error) return { source: 'unavailable', statuses: emptyStatuses() };
    return {
      source: 'live',
      statuses: new Map((result.data ?? []).map((row) => [
        row.location_id,
        Number.isInteger(row.oauth_scope_contract_version)
          ? squareConnectionStatus(row.oauth_scope_contract_version)
          : 'reauthorization-required',
      ])),
    };
  } catch {
    return { source: 'unavailable', statuses: emptyStatuses() };
  }
}

export function squareLocationUiStatus(
  load: SquareConnectionStatusLoad,
  locationId: string,
  fixtureConnected: boolean,
): SquareConnectionUiStatus | null {
  const status = load.statuses.get(locationId);
  if (status) return status;
  if (load.source === 'demo') return fixtureConnected ? 'connected' : null;
  if (load.source === 'unavailable' && fixtureConnected) return 'reauthorization-required';
  return null;
}
