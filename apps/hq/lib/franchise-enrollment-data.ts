import type { SupabaseClient } from '@supabase/supabase-js';

import { serverClient } from './supabase-server';

export type PendingEnrollment = {
  readonly agreementId: string;
  readonly networkId: string;
  readonly createdAt: string;
  readonly inheritancePolicy: unknown;
  readonly inheritanceRevision: number;
  readonly territory: unknown;
};

export type PendingEnrollmentResult = {
  readonly enrollments: PendingEnrollment[];
  readonly unavailable: boolean;
};

type AgreementRow = {
  id: string;
  network_id: string;
  created_at: string;
  inheritance_policy: unknown;
  inheritance_revision: number;
  territory: unknown;
};

export async function loadPendingEnrollments(
  brandId: string,
  providedClient?: SupabaseClient | null,
): Promise<PendingEnrollmentResult> {
  const client = providedClient === undefined ? await serverClient() : providedClient;
  if (!client) return { enrollments: [], unavailable: false };
  const result = await client
    .from('franchise_agreements')
    .select('id,network_id,created_at,inheritance_policy,inheritance_revision,territory')
    .eq('franchisee_brand_id', brandId)
    .eq('status', 'pending')
    .order('created_at')
    .returns<AgreementRow[]>();
  if (result.error) return { enrollments: [], unavailable: true };
  return {
    unavailable: false,
    enrollments: (result.data ?? []).map((row) => ({
      agreementId: row.id,
      networkId: row.network_id,
      createdAt: row.created_at,
      inheritancePolicy: row.inheritance_policy,
      inheritanceRevision: row.inheritance_revision,
      territory: row.territory,
    })),
  };
}
