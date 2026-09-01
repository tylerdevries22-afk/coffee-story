import { StorageWorkspace } from '@/components/storage-workspace';
import { currentSession, hasRole } from '@/lib/auth';
import { loadStorageWorkspace } from '@/lib/storage-data';

export const dynamic = 'force-dynamic';

export default async function StoragePage() {
  const session = await currentSession();
  if (!hasRole(session, 'brand_owner')) {
    return <section className="card storage-notice"><h1>Storage access is restricted</h1>
      <p className="subtitle">A brand owner can review asset records, upload files, and issue secure downloads.</p></section>;
  }
  return <StorageWorkspace initial={await loadStorageWorkspace()} />;
}
