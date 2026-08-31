import type { BrandRole } from '@platform/schema';

import { serverEnv, serviceDb } from './api-auth';
import type { SessionInfo } from './demo-data';
import { emailsForUserIds } from './staff-admin';
import { serverClient } from './supabase-server';
import { selectedOrganizationId } from './workspace-scope';

export type StaffDirectoryMember = {
  email: string;
  id: string;
  locationIds: string[];
  role: BrandRole;
  userId: string;
};

export type StaffDirectory = {
  configured: boolean;
  locations: { id: string; name: string }[];
  members: StaffDirectoryMember[];
};

export async function loadStaffDirectory(session: SessionInfo): Promise<StaffDirectory> {
  const client = await serverClient();
  const environment = serverEnv();
  if (!client || !environment) return { configured: false, locations: [], members: [] };
  const brandId = await selectedOrganizationId(session);
  const [membershipResult, locationResult] = await Promise.all([
    client.from('brand_users').select('id,user_id,role,location_ids')
      .eq('brand_id', brandId).order('created_at')
      .returns<{ id: string; user_id: string; role: BrandRole; location_ids: string[] }[]>(),
    client.from('locations').select('id,name').eq('brand_id', brandId).order('name')
      .returns<{ id: string; name: string }[]>(),
  ]);
  if (membershipResult.error || locationResult.error) {
    throw new Error('The staff directory could not be loaded.');
  }
  const rows = membershipResult.data ?? [];
  const emails = await emailsForUserIds(
    serviceDb(environment).auth.admin,
    new Set(rows.map((row) => row.user_id)),
  );
  return {
    configured: true,
    locations: locationResult.data ?? [],
    members: rows.map((row) => ({
      email: emails.get(row.user_id) ?? `Account ${row.user_id.slice(0, 8)}`,
      id: row.id,
      locationIds: row.location_ids,
      role: row.role,
      userId: row.user_id,
    })),
  };
}
