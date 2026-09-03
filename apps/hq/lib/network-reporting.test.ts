import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { SupabaseClient } from '@supabase/supabase-js';

import { loadNetworkReports, networkBrandKpisOf, networkTotals } from './network-reporting';

type Result = { data: unknown; error: unknown };

function queryStub(result: Result) {
  const builder = {
    contains: () => builder,
    limit: () => builder,
    order: () => builder,
    returns: () => Promise.resolve(result),
    select: () => builder,
  };
  return builder;
}

function fakeClient(options: {
  calls?: { name: string; networkId: unknown }[];
  grants?: Result;
  networks?: Result;
  rpc?: (networkId: string) => Result;
}): SupabaseClient {
  return {
    from: (table: string) => queryStub(
      table === 'franchise_networks'
        ? options.networks ?? { data: [], error: null }
        : options.grants ?? { data: [], error: null },
    ),
    rpc: (name: string, args: { p_network_id: string }) => {
      options.calls?.push({ name, networkId: args.p_network_id });
      return Promise.resolve(options.rpc ? options.rpc(args.p_network_id) : { data: [], error: null });
    },
  } as unknown as SupabaseClient;
}

function kpiRow(brandId: string, brandName: string, orders: unknown, gross: unknown) {
  return { brand_id: brandId, brand_name: brandName, gross_cents_30d: gross, orders_30d: orders };
}

describe('networkBrandKpisOf', () => {
  it('ranks brands by gross and keeps money as integer cents', () => {
    const rows = networkBrandKpisOf([
      kpiRow('brand-a', 'Union Station', 2, 2_000),
      kpiRow('brand-b', 'Riverside', 9, 12_500),
    ]);
    assert.deepEqual(rows.map((row) => row.brandId), ['brand-b', 'brand-a']);
    assert.equal(rows[0]?.grossCents30d, 12_500);
    assert.ok(Number.isSafeInteger(rows[0]?.grossCents30d ?? NaN));
  });

  it('accepts the string form PostgREST uses for a bigint', () => {
    const rows = networkBrandKpisOf([kpiRow('brand-a', 'Union Station', '4', '9007199254740')]);
    assert.equal(rows[0]?.grossCents30d, 9_007_199_254_740);
    assert.equal(rows[0]?.orders30d, 4);
  });

  /**
   * Dropping a bad row rather than coercing it is the point: a KPI surface
   * that renders NaN or a rounded float as dollars is worse than one that
   * reports fewer brands than the network holds.
   */
  it('drops rows it cannot read as an aggregate', () => {
    assert.deepEqual(networkBrandKpisOf([
      kpiRow('brand-a', 'Union Station', 1, 10.5),
      kpiRow('brand-b', 'Riverside', 1, -1),
      kpiRow('brand-c', 'Eastgate', 'not-a-number', 100),
      { brand_id: 'brand-d', gross_cents_30d: 100, orders_30d: 1 },
      null,
    ]), []);
    assert.deepEqual(networkBrandKpisOf('rows'), []);
  });
});

describe('networkTotals', () => {
  it('sums a network and answers zero for an empty one', () => {
    const totals = networkTotals(networkBrandKpisOf([
      kpiRow('brand-a', 'Union Station', 2, 2_000),
      kpiRow('brand-b', 'Riverside', 9, 12_500),
    ]));
    assert.deepEqual(totals, { grossCents30d: 14_500, orders30d: 11 });
    assert.deepEqual(networkTotals([]), { grossCents30d: 0, orders30d: 0 });
  });
});

describe('loadNetworkReports', () => {
  it('asks the caller-identity function and names only the network', async () => {
    const calls: { name: string; networkId: unknown }[] = [];
    const reports = await loadNetworkReports(fakeClient({
      calls,
      networks: { data: [{ id: 'net-1', name: 'Front Range' }], error: null },
      rpc: () => ({ data: [kpiRow('brand-a', 'Union Station', 2, 2_000)], error: null }),
    }));
    // The two-argument form takes the subject as input and is service-role
    // only; asking for it from a page would be the impersonation this release
    // exists to close.
    assert.deepEqual(calls, [{ name: 'caller_network_brand_kpis', networkId: 'net-1' }]);
    assert.equal(reports[0]?.networkName, 'Front Range');
    assert.equal(reports[0]?.brands[0]?.brandName, 'Union Station');
  });

  it('reaches a delegate’s network through their own grant row, unnamed', async () => {
    const reports = await loadNetworkReports(fakeClient({
      grants: { data: [{ network_id: 'net-2' }], error: null },
      networks: { data: [], error: null },
      rpc: () => ({ data: [kpiRow('brand-b', 'Riverside', 1, 800)], error: null }),
    }));
    assert.equal(reports.length, 1);
    assert.equal(reports[0]?.networkName, null, 'a delegate cannot read the network row');
    assert.equal(reports[0]?.networkId, 'net-2');
  });

  it('drops a network the database refuses rather than reporting an empty one', async () => {
    const reports = await loadNetworkReports(fakeClient({
      networks: { data: [{ id: 'net-1', name: 'Front Range' }, { id: 'net-3', name: 'Gone' }], error: null },
      rpc: (networkId) => networkId === 'net-1'
        ? { data: [kpiRow('brand-a', 'Union Station', 2, 2_000)], error: null }
        : { data: null, error: { code: 'P0002', message: 'network_access_denied' } },
    }));
    assert.deepEqual(reports.map((report) => report.networkId), ['net-1']);
  });

  it('lists a network once when the reader is both member and delegate', async () => {
    const calls: { name: string; networkId: unknown }[] = [];
    await loadNetworkReports(fakeClient({
      calls,
      grants: { data: [{ network_id: 'net-1' }], error: null },
      networks: { data: [{ id: 'net-1', name: 'Front Range' }], error: null },
    }));
    assert.equal(calls.length, 1, 'one network, one round trip');
  });

  it('returns nothing when the deployment carries no Supabase env', async () => {
    assert.deepEqual(await loadNetworkReports(null), []);
  });
});
