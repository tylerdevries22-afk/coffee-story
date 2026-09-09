import { DEMO_SESSION } from './demo-data';
import { serverClient } from './supabase-server';
import { selectedOrgId } from './workspace-location';
import { usesLaunchFixtures } from './demo-fixture-scope';

export async function demoFixture<T>(launch: T, neutral: T): Promise<T> {
  return usesLaunchFixtures(await selectedOrgId(), DEMO_SESSION.brandId) ? launch : neutral;
}

export function sevenDaysAgo(): string {
  const date = new Date();
  date.setDate(date.getDate() - 6);
  return date.toISOString().slice(0, 10);
}

export async function locationNames(
  client: NonNullable<Awaited<ReturnType<typeof serverClient>>>,
  orgId: string,
): Promise<ReadonlyMap<string, string>> {
  const rows = await client.from('locations').select('id, name').eq('brand_id', orgId)
    .returns<{ id: string; name: string }[]>();
  if (rows.error) throw new Error(`locations: ${rows.error.message}`);
  return new Map((rows.data ?? []).map((row) => [row.id, row.name]));
}
