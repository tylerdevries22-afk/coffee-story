import { DEMO_CAMPAIGNS, DEMO_CUSTOMERS, DEMO_FEES, type CampaignSummary, type CustomerSummary, type FeeRow } from './demo-data';
import {
  campaignSummariesOf, customerSummariesOf, feeRowsOf,
  type CampaignRowLike, type CustomerOrderRow, type CustomerRowLike,
  type PlatformFeeRowLike, type PointsRow,
} from './live-mappers';
import { serverClient } from './supabase-server';
import { selectedLocationId } from './workspace-location';
import { scopeRowsToLocation } from './location-scope';
import { liveScope } from './live-scope';
import { demoFixture, locationNames } from './data-shared';

export async function loadCampaigns(): Promise<CampaignSummary[]> {
  const client = await serverClient();
  if (!client) return demoFixture(DEMO_CAMPAIGNS, []);
  const scope = await liveScope(client);
  if (!scope.orgId) return [];
  const rows = await client
    .from('campaigns')
    .select('id, name, channel, status, scheduled_at, audience, stats')
    .eq('brand_id', scope.orgId)
    .order('created_at', { ascending: false })
    .returns<CampaignRowLike[]>();
  if (rows.error) throw new Error(`campaigns: ${rows.error.message}`);
  return campaignSummariesOf(rows.data ?? []);
}

export async function loadCustomers(): Promise<CustomerSummary[]> {
  const client = await serverClient();
  if (!client) return demoFixture(DEMO_CUSTOMERS, []);
  const scope = await liveScope(client);
  if (!scope.orgId) return [];
  // RLS already narrows what this role may see (managers brand-wide, shift
  // staff only guests with orders at their locations).
  const [customers, points, orders] = await Promise.all([
    client
      .from('customers')
      .select('id, full_name, phone')
      .eq('brand_id', scope.orgId)
      .order('created_at', { ascending: false })
      .limit(200)
      .returns<CustomerRowLike[]>(),
    client.from('loyalty_accounts').select('customer_id, points_balance').eq('brand_id', scope.orgId).returns<PointsRow[]>(),
    client
      .from('orders')
      .select('customer_id, total_cents, status, created_at')
      .eq('brand_id', scope.orgId)
      .order('created_at', { ascending: false })
      .limit(2000)
      .returns<CustomerOrderRow[]>(),
  ]);
  if (customers.error) throw new Error(`customers: ${customers.error.message}`);
  if (points.error) throw new Error(`loyalty_accounts: ${points.error.message}`);
  if (orders.error) throw new Error(`orders: ${orders.error.message}`);
  return customerSummariesOf(customers.data ?? [], points.data ?? [], orders.data ?? []);
}

export async function loadFees(): Promise<FeeRow[]> {
  const locationId = await selectedLocationId();
  const client = await serverClient();
  if (!client) return demoFixture(scopeRowsToLocation(DEMO_FEES, locationId), []);
  const scope = await liveScope(client);
  if (!scope.orgId || scope.locationIds.length === 0) return [];
  const base = client
    .from('platform_fees')
    .select('location_id, gross_cents, fee_cents, created_at')
    .eq('brand_id', scope.orgId)
    .order('created_at', { ascending: false })
    .limit(5000);
  const [rows, names] = await Promise.all([
    (scope.locationId ? base.eq('location_id', scope.locationId) : base.in('location_id', [...scope.locationIds])).returns<PlatformFeeRowLike[]>(),
    locationNames(client, scope.orgId),
  ]);
  if (rows.error) throw new Error(`platform_fees: ${rows.error.message}`);
  return feeRowsOf(rows.data ?? [], names);
}
