import { randomUUID } from 'node:crypto';

import { sql } from './stack.ts';

export interface QuoteRow {
  quote_claim_created: boolean;
  quote_claim_generation: string | null;
  quoted_fee_bps_applied: number;
  quoted_fee_cents: number;
}

export async function currentPeriod(
  locationId: string,
): Promise<{ monthEnd: string; monthStart: string }> {
  const period = await sql<{ month_end: string; month_start: string }>(
    `select timezone(location.timezone,
       date_trunc('month', timezone(location.timezone, now())))::text month_start,
       timezone(location.timezone,
       date_trunc('month', timezone(location.timezone, now())) + interval '1 month')::text month_end
     from public.locations location where location.id = $1`,
    [locationId],
  );
  return { monthStart: period.rows[0]!.month_start, monthEnd: period.rows[0]!.month_end };
}

export async function seedSquareConnection(brandId: string, locationId: string): Promise<void> {
  await sql(
    `insert into public.square_connections (
       brand_id, location_id, merchant_id, square_location_id,
       access_token_encrypted, refresh_token_encrypted, expires_at
     ) values ($1, $2, $3, $4, $5, $6, now() + interval '1 hour')`,
    [brandId, locationId, `merchant-${randomUUID()}`, `location-${randomUUID()}`,
      `access-${randomUUID()}`, `refresh-${randomUUID()}`],
  );
}

export async function squareConnectionSnapshot(
  locationId: string,
): Promise<{ connection_generation: string; id: string }> {
  const result = await sql<{ connection_generation: string; id: string }>(
    `select id, connection_generation from public.square_connections where location_id = $1`,
    [locationId],
  );
  return result.rows[0]!;
}
